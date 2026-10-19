import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  normalizeContext,
} from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import { parseApiKey } from "../src/antigravity/client.ts";
import { ANTIGRAVITY_MODELS } from "../src/antigravity/models.ts";
import {
  buildRequest,
  convertMessages,
  convertTools,
  parseSseStream,
  resolveCurrentSystemPrompt,
  resolveCurrentTools,
} from "../src/antigravity/stream.ts";
import { normalizeAntigravityUsage } from "../src/antigravity/usage.ts";

describe("credentials and project resolution", () => {
  test("rejects invalid credentials", () => {
    expect(() => parseApiKey("not-json")).toThrow();
    expect(() => parseApiKey(JSON.stringify({ token: "only-token" }))).toThrow();
    expect(() => parseApiKey(undefined)).toThrow();
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
