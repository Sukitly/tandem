import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  normalizeContext,
} from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import { parseApiKey, resolveProjectId } from "../src/antigravity/client.ts";
import { ANTIGRAVITY_MODELS, getAntigravityRequestModelId, getThinkingConfig } from "../src/antigravity/models.ts";
import { getApiKey, refreshAntigravityToken } from "../src/antigravity/oauth.ts";
import { antigravityProvider } from "../src/antigravity/provider.ts";
import {
  buildRequest,
  convertMessages,
  convertTools,
  parseSseStream,
  resolveCurrentSystemPrompt,
  resolveCurrentTools,
} from "../src/antigravity/stream.ts";
import { normalizeAntigravityUsage } from "../src/antigravity/usage.ts";

describe("antigravityProvider metadata", () => {
  const provider = antigravityProvider();

  test("has correct id, name and baseUrl", () => {
    expect(provider.id).toBe("antigravity");
    expect(provider.name).toBe("Antigravity");
    expect(provider.baseUrl).toBe("https://daily-cloudcode-pa.googleapis.com");
  });

  test("provides oauth auth with subscription tag and loginLabel", () => {
    expect(provider.auth.oauth).toBeDefined();
    expect(provider.auth.oauth?.name).toBe("Antigravity");
    expect(provider.auth.oauth?.loginLabel).toBe("Sign in with Google");
    expect(provider.auth.oauth?.isSubscription).toBe(true);
    expect(typeof provider.auth.oauth?.login).toBe("function");
    expect(typeof provider.auth.oauth?.refresh).toBe("function");
    expect(typeof provider.auth.oauth?.toAuth).toBe("function");
  });

  test("provides baseline models including Gemini, Claude, and GPT-OSS", () => {
    const models = provider.getModels();
    expect(models.length).toBeGreaterThanOrEqual(8);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("gemini-3.8-flash");
    expect(ids).toContain("gemini-3.7-flash");
    expect(ids).toContain("gemini-3.1-pro");
    expect(ids).toContain("claude-sonnet-4-6");
    expect(ids).toContain("claude-opus-4-6");
    expect(ids).toContain("gpt-oss-120b");

    for (const model of models) {
      expect(model.provider).toBe("antigravity");
      expect(model.api).toBe("antigravity");
      expect(model.type).toBe("chat");
    }
  });
});

describe("model routing and thinking configuration", () => {
  test("routes gemini-3.8-flash by thinking effort", () => {
    expect(getAntigravityRequestModelId("gemini-3.8-flash", "off")).toBe("gemini-3.8-flash-low");
    expect(getAntigravityRequestModelId("gemini-3.8-flash", "low")).toBe("gemini-3.8-flash-low");
    expect(getAntigravityRequestModelId("gemini-3.8-flash", "medium")).toBe("gemini-3.8-flash-medium");
    expect(getAntigravityRequestModelId("gemini-3.8-flash", "high")).toBe("gemini-3.8-flash-high");
  });

  test("routes claude-sonnet-4-6 consistently", () => {
    expect(getAntigravityRequestModelId("claude-sonnet-4-6", "off")).toBe("claude-sonnet-4-6");
    expect(getAntigravityRequestModelId("claude-sonnet-4-6", "high")).toBe("claude-sonnet-4-6");
  });

  test("generates thinking configuration", () => {
    const geminiHigh = getThinkingConfig("gemini-3.8-flash-high", "high");
    expect(geminiHigh).toEqual({ includeThoughts: true, thinkingBudget: 16384 });

    const geminiOff = getThinkingConfig("gemini-3.8-flash-low", "off");
    expect(geminiOff).toEqual({ includeThoughts: false, thinkingBudget: 0 });

    const claudeOff = getThinkingConfig("claude-sonnet-4-6", "off");
    expect(claudeOff).toEqual({ includeThoughts: true, thinkingBudget: 16384 });
  });
});

describe("credentials and project resolution", () => {
  test("parses valid JSON credentials", () => {
    const parsed = parseApiKey(JSON.stringify({ token: "test-token", projectId: "test-project" }));
    expect(parsed).toEqual({ token: "test-token", projectId: "test-project" });
  });

  test("rejects invalid credentials", () => {
    expect(() => parseApiKey("not-json")).toThrow();
    expect(() => parseApiKey(JSON.stringify({ token: "only-token" }))).toThrow();
    expect(() => parseApiKey(undefined)).toThrow();
  });

  test("resolves project ID with priority", () => {
    expect(resolveProjectId({ token: "t", credentialProjectId: "p1", warmedProject: "p2" })).toBe("p1");
    expect(resolveProjectId({ token: "t", warmedProject: "p2" })).toBe("p2");
    expect(resolveProjectId({ token: "t" })).toBeTruthy();
  });

  test("formats credentials for api key resolution", () => {
    const cred = {
      type: "oauth" as const,
      access: "access-token-123",
      refresh: "refresh-token-456",
      expires: Date.now() + 3600000,
      projectId: "project-abc",
    };
    const keyStr = getApiKey(cred);
    expect(JSON.parse(keyStr)).toEqual({
      token: "access-token-123",
      projectId: "project-abc",
    });
  });
});

describe("request and messages transformation", () => {
  const model = ANTIGRAVITY_MODELS[0] ?? {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash (Antigravity)",
    provider: "antigravity",
    api: "antigravity",
    baseUrl: "https://daily-cloudcode-pa.googleapis.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
    contextWindow: 1048576,
    maxTokens: 65536,
    type: "chat" as const,
  };

  test("converts user and assistant messages to Gemini contents with signed tool calls", () => {
    const validSignature = "0123456789abcdef";
    const context: Context = {
      messages: [
        { role: "user", content: "Hello world", timestamp: Date.now() },
        {
          role: "assistant",
          provider: "antigravity",
          model: "gemini-3.8-flash",
          api: "antigravity",
          timestamp: Date.now(),
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          content: [
            { type: "text", text: "Hi there!" },
            {
              type: "toolCall",
              id: "call_1",
              name: "read",
              arguments: { path: "README.md" },
              thoughtSignature: validSignature,
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "read",
          content: [{ type: "text", text: "# Readme file" }],
          isError: false,
          timestamp: Date.now(),
        },
      ],
    };

    const contents = convertMessages(model, context, "gemini-3.8-flash-low");
    expect(contents.length).toBe(3);
    expect(contents[0]?.role).toBe("user");
    expect(contents[0]?.parts[0]).toEqual({ text: "Hello world" });
    expect(contents[1]?.role).toBe("model");
    expect(contents[2]?.role).toBe("user");
    expect(contents[2]?.parts[0]).toHaveProperty("functionResponse");
  });

  test("falls back to text observation when tool call lacks thought signature on Gemini", () => {
    const context: Context = {
      messages: [
        { role: "user", content: "Hello world", timestamp: Date.now() },
        {
          role: "assistant",
          provider: "antigravity",
          model: "gemini-3.8-flash",
          api: "antigravity",
          timestamp: Date.now(),
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          content: [
            { type: "text", text: "Hi there!" },
            { type: "toolCall", id: "call_unsigned", name: "read", arguments: { path: "README.md" } },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "call_unsigned",
          toolName: "read",
          content: [{ type: "text", text: "# Readme file" }],
          isError: false,
          timestamp: Date.now(),
        },
      ],
    };

    const contents = convertMessages(model, context, "gemini-3.8-flash-low");
    expect(contents[2]?.parts[0]).toHaveProperty("text");
    const part = contents[2]?.parts[0] as { text: string } | undefined;
    expect(part?.text).toContain("[Observation from `read`");
  });

  test("converts tool schemas to Gemini function declarations", () => {
    const tools = [
      {
        name: "bash",
        description: "Run shell command",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Command to execute" },
          },
          required: ["command"],
        },
      },
    ];

    const declarations = convertTools(tools);
    expect(declarations).toBeDefined();
    expect(declarations?.[0]?.functionDeclarations[0]?.name).toBe("bash");
    expect(declarations?.[0]?.functionDeclarations[0]?.description).toBe("Run shell command");
    expect(declarations?.[0]?.functionDeclarations[0]?.parametersJsonSchema).toEqual({
      type: "object",
      properties: { command: { type: "string", description: "Command to execute" } },
      required: ["command"],
    });
  });

  test("builds full generate request payload", () => {
    const context: Context = {
      systemPrompt: "You are a test assistant.",
      messages: [{ role: "user", content: "List files", timestamp: Date.now() }],
    };

    const request = buildRequest(model, context, "proj-123", {}, "gemini-3.8-flash-low");
    expect(request.project).toBe("proj-123");
    expect(request.model).toBe("gemini-3.8-flash-low");
    expect(request.request.contents.length).toBeGreaterThan(0);
    expect(request.request.systemInstruction.parts[0]?.text).toBe("You are a test assistant.");
    expect(request.request.generationConfig?.maxOutputTokens).toBe(65536);
  });

  test("resolves tools and system prompt from normalized TranscriptContext", () => {
    const context: Context = {
      systemPrompt: "System instruction from prompt",
      messages: [{ role: "user", content: "Check status", timestamp: Date.now() }],
      tools: [
        {
          name: "bash",
          description: "Run bash command",
          parameters: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
          },
        },
      ],
    };

    const normalized = normalizeContext(context);
    expect((normalized as Partial<Context>).tools).toBeUndefined();
    expect((normalized as Partial<Context>).systemPrompt).toBeUndefined();

    const resolvedTools = resolveCurrentTools(normalized);
    expect(resolvedTools?.length).toBe(1);
    expect(resolvedTools?.[0]?.name).toBe("bash");

    const resolvedPrompt = resolveCurrentSystemPrompt(normalized);
    expect(resolvedPrompt).toBe("System instruction from prompt");

    const request = buildRequest(model, normalized, "proj-123", {}, "gemini-3.8-flash-low");
    expect(request.request.tools).toBeDefined();
    expect(request.request.tools?.[0]?.functionDeclarations[0]?.name).toBe("bash");
    expect(request.request.systemInstruction.parts[0]?.text).toBe("System instruction from prompt");
  });

  test("resolves tools and sections from durable harness messages", () => {
    const durableContext = {
      messages: [
        {
          role: "system",
          content: "",
          sections: {
            preamble: "You are an expert coding assistant working inside Tandem.",
            tools: "- bash: Run shell command\n- read: Read file",
          },
          toolsAdded: [
            {
              name: "bash",
              description: "Run shell command",
              parameters: {
                type: "object",
                properties: { command: { type: "string" } },
                required: ["command"],
              },
            },
            {
              name: "read",
              description: "Read file",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
            },
          ],
        },
        { role: "user", content: "List files" },
      ],
    } as Context;

    const resolvedTools = resolveCurrentTools(durableContext);
    expect(resolvedTools?.map((t) => t.name)).toEqual(["bash", "read"]);

    const resolvedPrompt = resolveCurrentSystemPrompt(durableContext);
    expect(resolvedPrompt).toContain("You are an expert coding assistant working inside Tandem.");
    expect(resolvedPrompt).toContain("- bash: Run shell command");

    const request = buildRequest(model, durableContext, "proj-123", {}, "gemini-3.8-flash-low");
    expect(request.request.tools).toBeDefined();
    expect(request.request.tools?.[0]?.functionDeclarations.map((f) => f.name)).toEqual(["bash", "read"]);
    expect(request.request.systemInstruction.parts[0]?.text).toContain("You are an expert coding assistant");
  });

  test("dereferences schema with $ref and cleans meta-schema keywords", () => {
    const tools = [
      {
        name: "edit",
        description: "Edit file",
        parameters: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $defs: {
            editItem: {
              type: "object",
              properties: {
                oldText: { type: "string" },
                newText: { type: "string" },
              },
              required: ["oldText", "newText"],
            },
          },
          type: "object",
          properties: {
            path: { type: "string" },
            edits: {
              type: "array",
              items: { $ref: "#/$defs/editItem" },
            },
          },
          required: ["path", "edits"],
        },
      },
    ];

    const geminiDeclarations = convertTools(tools, false);
    const geminiEdit = geminiDeclarations?.[0]?.functionDeclarations[0];
    expect(geminiEdit?.parametersJsonSchema).toEqual({
      type: "object",
      properties: {
        path: { type: "string" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              oldText: { type: "string" },
              newText: { type: "string" },
            },
            required: ["oldText", "newText"],
          },
        },
      },
      required: ["path", "edits"],
    });

    const claudeDeclarations = convertTools(tools, true);
    const claudeEdit = claudeDeclarations?.[0]?.functionDeclarations[0];
    expect(claudeEdit?.parameters).toBeDefined();
    const claudeParams = claudeEdit?.parameters as Record<string, unknown> | undefined;
    expect(claudeParams?.properties).toBeDefined();
  });
});

describe("SSE stream parsing", () => {
  const model = ANTIGRAVITY_MODELS[0] ?? {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash (Antigravity)",
    provider: "antigravity",
    api: "antigravity",
    baseUrl: "https://daily-cloudcode-pa.googleapis.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
    contextWindow: 1048576,
    maxTokens: 65536,
    type: "chat" as const,
  };

  test("parses text, thinking, and usage tokens", async () => {
    const sseData = [
      'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"Let me think..."}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello, human!"}]}}],"finishReason":"STOP","usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"thoughtsTokenCount":3,"totalTokenCount":18}}\n\n',
    ].join("");

    const response = new Response(sseData, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      stopReason: "stop",
      model: model.id,
      provider: "antigravity",
      api: model.api,
      timestamp: Date.now(),
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };

    const stream = createAssistantMessageEventStream();
    const events: unknown[] = [];
    (async () => {
      for await (const event of stream) {
        events.push(event);
      }
    })();

    const hasContent = await parseSseStream(response, output, stream, model);
    expect(hasContent).toBe(true);
    expect(output.stopReason).toBe("stop");
    expect(output.usage.input).toBe(10);
    expect(output.usage.output).toBe(8); // candidates (5) + thoughts (3)
    expect(output.usage.totalTokens).toBe(18);
    expect(output.content.some((b) => b.type === "thinking")).toBe(true);
    expect(output.content.some((b) => b.type === "text")).toBe(true);
  });
});

describe("quota usage normalization", () => {
  test("normalizes aggregate quota summary into groups sorted by windowSeconds", () => {
    const raw = {
      groups: [
        {
          displayName: "Claude and GPT models",
          buckets: [
            {
              displayName: "Weekly",
              window: "weekly",
              remainingFraction: 0.76,
              resetTime: "2026-04-07T00:00:00Z",
            },
            {
              displayName: "5 hours",
              window: "5h",
              remainingFraction: 0.32,
              resetTime: "2026-04-01T12:00:00Z",
            },
          ],
        },
        {
          displayName: "Gemini models",
          buckets: [
            {
              displayName: "Weekly",
              window: "weekly",
              remainingFraction: 0.48,
              resetTime: "2026-04-07T00:00:00Z",
            },
            {
              displayName: "5 hours",
              window: "5h",
              remainingFraction: 0.0,
              resetTime: "2026-04-01T12:00:00Z",
            },
          ],
        },
      ],
    };

    const usage = normalizeAntigravityUsage(raw);
    expect(usage.groups).toBeDefined();
    expect(usage.groups?.gemini).toEqual([
      {
        label: "5h",
        utilization: 100, // (1 - 0.0) * 100
        windowSeconds: 5 * 3600,
        resetsAt: "2026-04-01T12:00:00Z",
      },
      {
        label: "7d",
        utilization: 52, // (1 - 0.48) * 100
        windowSeconds: 7 * 86400,
        resetsAt: "2026-04-07T00:00:00Z",
      },
    ]);
    expect(usage.groups?.["claude-gpt"]).toEqual([
      {
        label: "5h",
        utilization: 68, // (1 - 0.32) * 100
        windowSeconds: 5 * 3600,
        resetsAt: "2026-04-01T12:00:00Z",
      },
      {
        label: "7d",
        utilization: 24, // (1 - 0.76) * 100
        windowSeconds: 7 * 86400,
        resetsAt: "2026-04-07T00:00:00Z",
      },
    ]);
    expect(usage.windows).toEqual(usage.groups?.gemini);
  });
});

describe("oauth token refresh", () => {
  test("refreshes expired access token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "new-access-token",
          expires_in: 3600,
          refresh_token: "new-refresh-token",
        }),
      }),
    );

    const credential = {
      type: "oauth" as const,
      access: "old-access",
      refresh: "old-refresh",
      expires: 1000,
      projectId: "existing-proj",
    };

    const refreshed = await refreshAntigravityToken(credential);
    expect(refreshed.access).toBe("new-access-token");
    expect(refreshed.refresh).toBe("new-refresh-token");
    expect(refreshed.projectId).toBe("existing-proj");
    expect(refreshed.expires).toBeGreaterThan(Date.now());

    vi.unstubAllGlobals();
  });
});
