import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  calculateCost,
  createAssistantMessageEventStream,
  type Model,
  type TextContent,
  type Tool,
  type ToolCall,
} from "@earendil-works/pi-ai";
import {
  antigravityHeaders,
  endpointCandidates,
  fetchAvailableRuntimeModel,
  jsonOrTextError,
  loadCodeAssist,
  parseApiKey,
  resolveProjectId,
} from "./client.ts";
import {
  ANTIGRAVITY_ROUTING,
  getAntigravityRequestModelId,
  getFallbackRuntimeModel,
  getMaxOutputTokens,
  getThinkingConfig,
  PROVIDER_ID,
} from "./models.ts";
import {
  type ActiveBlock,
  type AntigravityGenerateRequest,
  type AntigravityStreamOptions,
  type ContentBlock,
  type GeminiContent,
  type GeminiFunctionDeclaration,
  type GeminiFunctionResponsePart,
  type GeminiGenerationConfig,
  type GeminiInlineDataPart,
  type GeminiPart,
  type GeminiRequestBody,
  GeminiRole,
  GeminiToolCallingMode,
  type LooseImageBlock,
  StopReason,
  type StreamChunk,
  ToolChoice,
} from "./types.ts";
import {
  antigravityEnv,
  antigravityRequestEnvelope,
  isRecord,
  resolveSessionTrajectory,
  safeError,
  sanitizeText,
} from "./util.ts";

const ANTIGRAVITY_SYSTEM_INSTRUCTION =
  "You are Antigravity, a powerful agentic AI coding assistant designed by Google DeepMind. " +
  "You are pair programming with a user to solve coding tasks. Be concise, practical, and tool-aware.";

const ANTIGRAVITY_NO_PREAMBLE_INSTRUCTION =
  "CRITICAL: NEVER output rule checks, formatting guidelines, constraint checklists, or your thinking preambles in the final response. Output only the final response.";

let toolCallCounter = 0;

function sanitizeToolCallId(id: string, fallbackName?: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const capped = cleaned.slice(0, 64);
  return capped || `${fallbackName || "tool"}_${++toolCallCounter}`;
}

function toolCallIdNeeded(modelId: string, runtimeModel: string): boolean {
  return (
    modelId.startsWith("claude-") ||
    modelId.startsWith("gpt-oss-") ||
    runtimeModel.startsWith("claude-") ||
    runtimeModel.startsWith("gpt-oss-")
  );
}

function asTextParts(content: unknown): GeminiPart[] {
  if (typeof content === "string") return content ? [{ text: sanitizeText(content) }] : [];
  if (!Array.isArray(content)) return [];
  const parts: GeminiPart[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      if (block) parts.push({ text: sanitizeText(block) });
    } else if (isRecord(block)) {
      if (block.type === "text" && typeof block.text === "string" && block.text) {
        parts.push({ text: sanitizeText(block.text) });
      } else if (block.type === "image") {
        const image = block as LooseImageBlock;
        const data = image.data || image.source?.data;
        const mimeType = image.mimeType || image.mediaType || image.source?.mediaType || "image/png";
        if (data) parts.push({ inlineData: { mimeType, data } });
      }
    }
  }
  return parts;
}

function asImageParts(content: unknown): GeminiInlineDataPart[] {
  if (!Array.isArray(content)) return [];
  const parts: GeminiInlineDataPart[] = [];
  for (const block of content) {
    if (isRecord(block) && block.type === "image") {
      const image = block as LooseImageBlock;
      const data = image.data || image.source?.data;
      const mimeType = image.mimeType || image.mediaType || image.source?.mediaType || "image/png";
      if (data) parts.push({ inlineData: { mimeType, data } });
    }
  }
  return parts;
}

function appendTurn(contents: GeminiContent[], role: GeminiRole, parts: GeminiPart[]): void {
  if (parts.length === 0) return;
  const last = contents.at(-1);
  if (last && last.role === role) {
    last.parts.push(...parts);
  } else {
    contents.push({ role, parts });
  }
}

function geminiRequiresThoughtSignature(runtimeModel: string): boolean {
  return runtimeModel.startsWith("gemini-") && !runtimeModel.includes("flash-lite");
}

function isValidThoughtSignature(sig: unknown): boolean {
  return typeof sig === "string" && sig.length >= 16;
}

export function convertMessages(model: Model<Api>, context: Context, runtimeModel: string): GeminiContent[] {
  const contents: GeminiContent[] = [];
  const requiresSig = geminiRequiresThoughtSignature(runtimeModel);
  const droppedToolCallIds = new Map<string, string>();

  for (const msg of context.messages) {
    if (msg.role === "system") continue;
    if (msg.role === "user") {
      const parts = asTextParts(msg.content);
      appendTurn(contents, GeminiRole.User, parts);
    } else if (msg.role === "assistant") {
      if (msg.stopReason === "error" || msg.stopReason === "aborted") continue;
      const parts: GeminiPart[] = [];
      const isSameModel = msg.provider === PROVIDER_ID && msg.model === model.id;
      const toolCalls = msg.content.filter((b): b is ToolCall => b.type === "toolCall");
      const firstCallHasSig = toolCalls.length > 0 && isValidThoughtSignature(toolCalls[0]?.thoughtSignature);
      const allSigsValid = toolCalls.every(
        (tc) => !tc.thoughtSignature || isValidThoughtSignature(tc.thoughtSignature),
      );
      const groupIsSigned = isSameModel && firstCallHasSig && allSigsValid;

      for (const block of msg.content) {
        if (block.type === "text") {
          const textSig = isSameModel && isValidThoughtSignature(block.textSignature) ? block.textSignature : undefined;
          if ((!block.text || block.text.trim() === "") && !textSig) continue;
          parts.push({
            text: sanitizeText(block.text),
            ...(textSig ? { thoughtSignature: textSig } : {}),
          });
        } else if (block.type === "thinking" && String(block.thinking || "").trim()) {
          if (!isSameModel) continue;
          parts.push({
            thought: true,
            text: sanitizeText(block.thinking),
            ...(block.thinkingSignature ? { thoughtSignature: block.thinkingSignature } : {}),
          });
        } else if (block.type === "toolCall") {
          if (requiresSig && !groupIsSigned) {
            const rawId = block.id || "";
            const argsText = JSON.stringify(block.arguments ?? {});
            if (rawId) {
              droppedToolCallIds.set(rawId, argsText);
              droppedToolCallIds.set(sanitizeToolCallId(rawId, block.name), argsText);
            } else {
              droppedToolCallIds.set(`empty:${block.name}`, argsText);
            }
          } else {
            parts.push({
              functionCall: {
                name: block.name,
                args: (block.arguments as Record<string, unknown>) ?? {},
                ...(toolCallIdNeeded(model.id, runtimeModel)
                  ? { id: sanitizeToolCallId(block.id || "", block.name) }
                  : {}),
              },
              ...(block.thoughtSignature ? { thoughtSignature: block.thoughtSignature } : {}),
            });
          }
        }
      }
      appendTurn(contents, GeminiRole.Model, parts);
    } else if (msg.role === "toolResult") {
      const text = msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => sanitizeText(c.text))
        .join("\n");
      const responseText = text || (msg.isError ? "Tool failed" : "");
      const imageParts = asImageParts(msg.content);
      const rawId = msg.toolCallId || "";
      const sanitizedId = toolCallIdNeeded(model.id, runtimeModel) ? sanitizeToolCallId(rawId, msg.toolName) : rawId;
      const droppedArgs = requiresSig
        ? (droppedToolCallIds.get(rawId) ??
          droppedToolCallIds.get(sanitizedId) ??
          (rawId === "" ? droppedToolCallIds.get(`empty:${msg.toolName}`) : undefined))
        : undefined;

      if (droppedArgs !== undefined) {
        const label = droppedArgs === "{}" ? `\`${msg.toolName}\`` : `\`${msg.toolName}\` (${droppedArgs})`;
        appendTurn(contents, GeminiRole.User, [
          { text: sanitizeText(`[Observation from ${label}:\n${responseText}]`) },
          ...imageParts,
        ]);
      } else {
        const part: GeminiFunctionResponsePart = {
          functionResponse: {
            name: msg.toolName,
            response: msg.isError ? { error: responseText } : { output: responseText },
            ...(toolCallIdNeeded(model.id, runtimeModel)
              ? { id: sanitizeToolCallId(msg.toolCallId || "", msg.toolName) }
              : {}),
          },
        };
        appendTurn(contents, GeminiRole.User, [part, ...imageParts]);
      }
    }
  }

  return contents;
}

export function convertTools(
  tools: Tool[] | undefined,
  useLegacyParameters = false,
): { functionDeclarations: GeminiFunctionDeclaration[] }[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const functionDeclarations: GeminiFunctionDeclaration[] = tools.map((tool) => {
    const schema = tool.parameters && isRecord(tool.parameters) ? { ...tool.parameters } : {};
    delete schema.$schema;
    delete schema.$id;
    return {
      name: tool.name,
      description: tool.description,
      ...(useLegacyParameters ? { parameters: schema } : { parametersJsonSchema: schema }),
    };
  });
  return [{ functionDeclarations }];
}

function mapToolChoiceMode(toolChoice: AntigravityStreamOptions["toolChoice"]): GeminiToolCallingMode {
  if (toolChoice === ToolChoice.None) return GeminiToolCallingMode.None;
  if (toolChoice === ToolChoice.Any || toolChoice === ToolChoice.Required) return GeminiToolCallingMode.Any;
  return GeminiToolCallingMode.Auto;
}

export function buildRequest(
  model: Model<Api>,
  context: Context,
  _projectId: string,
  options: AntigravityStreamOptions,
  runtimeModel: string,
): AntigravityGenerateRequest {
  const systemPromptText = context.systemPrompt ? sanitizeText(context.systemPrompt) : undefined;
  const systemParts = systemPromptText
    ? [{ text: systemPromptText }]
    : [{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION }, { text: ANTIGRAVITY_NO_PREAMBLE_INSTRUCTION }];

  const contents = convertMessages(model, context, runtimeModel);
  const hasUserText = contents.some(
    (turn) => turn.role === GeminiRole.User && turn.parts.some((part) => "text" in part && Boolean(part.text.trim())),
  );
  if (!hasUserText) {
    contents.unshift({
      role: GeminiRole.User,
      parts: [{ text: "Apply the active system instructions." }],
    });
  }

  const request: GeminiRequestBody = {
    contents,
    systemInstruction: {
      role: "user",
      parts: systemParts,
    },
  };

  const generationConfig: GeminiGenerationConfig = {};
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
  const thinking = getThinkingConfig(runtimeModel, (options.reasoning as string) ?? "off");
  if (thinking) generationConfig.thinkingConfig = thinking;
  generationConfig.maxOutputTokens = getMaxOutputTokens(model.id, runtimeModel);
  request.generationConfig = generationConfig;

  const isNonGemini = runtimeModel.startsWith("claude-") || runtimeModel.startsWith("gpt-oss-");
  const tools = convertTools(options.tools ?? context.tools, isNonGemini);
  if (tools) request.tools = tools;
  if (options.toolChoice) {
    request.toolConfig = {
      functionCallingConfig: {
        mode: mapToolChoiceMode(options.toolChoice),
      },
    };
  }

  const sessionTrajectory = resolveSessionTrajectory(context, options.sessionId as string | undefined);
  const envelope = antigravityRequestEnvelope(runtimeModel, Boolean(tools?.length), {
    isClaude: runtimeModel.startsWith("claude-"),
    isNonGemini,
    trajectoryId: sessionTrajectory.trajectoryId,
    conversationId: sessionTrajectory.conversationId,
    sessionId: sessionTrajectory.sessionId,
  });

  request.sessionId = envelope.sessionId;
  request.labels = envelope.labels;

  return {
    project: _projectId,
    model: runtimeModel,
    request,
    requestType: "agent",
    userAgent: "antigravity",
    requestId: envelope.requestId,
  };
}

const STREAM_HEADER_TIMEOUT_MS = 180_000;
const STREAM_STALL_TIMEOUT_MS = 120_000;

export async function fetchWithHeaderDeadline(
  url: string,
  init: RequestInit,
  callerSignal: AbortSignal | undefined,
  headerDeadlineMs = STREAM_HEADER_TIMEOUT_MS,
  stallMs = STREAM_STALL_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let armed = true;

  const abortOnCaller = () => {
    if (callerSignal?.aborted) controller.abort(callerSignal.reason);
  };
  callerSignal?.addEventListener("abort", abortOnCaller, { once: true });

  const timer =
    headerDeadlineMs > 0
      ? setTimeout(() => {
          if (armed) controller.abort(new Error(`request timed out after ${headerDeadlineMs}ms`));
        }, headerDeadlineMs)
      : undefined;

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    armed = false;
    if (timer) clearTimeout(timer);

    if (!res.body || stallMs <= 0) return res;

    // Body stall watchdog
    const reader = res.body.getReader();
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(new Error(`stream stalled for ${stallMs}ms`)), stallMs);
    };

    resetStallTimer();
    const stream = new ReadableStream<Uint8Array>({
      async pull(c) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            if (stallTimer) clearTimeout(stallTimer);
            c.close();
            return;
          }
          resetStallTimer();
          c.enqueue(chunk.value);
        } catch (err) {
          if (stallTimer) clearTimeout(stallTimer);
          c.error(err);
        }
      },
      cancel(reason) {
        if (stallTimer) clearTimeout(stallTimer);
        return reader.cancel(reason);
      },
    });

    return new Response(stream, res);
  } finally {
    if (armed && timer) clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortOnCaller);
  }
}

function mapStopReason(finishReason: string | undefined): AssistantMessage["stopReason"] {
  if (!finishReason) return "stop";
  switch (finishReason.toUpperCase()) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "error";
    default:
      return "stop";
  }
}

export async function parseSseStream(
  response: Response,
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
  model?: Model<Api>,
): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let started = false;
  let hasContent = false;
  let sawFinishReason = false;

  const blocks: ContentBlock[] = [];
  let currentBlock: ActiveBlock | null = null;

  const blockIndex = () => blocks.length - 1;

  const ensureStarted = () => {
    if (!started) {
      stream.push({ type: "start", partial: output });
      started = true;
    }
  };

  const finishCurrent = () => {
    if (!currentBlock) return;
    if (currentBlock.type === "text") {
      stream.push({
        type: "text_end",
        contentIndex: blockIndex(),
        content: currentBlock.text,
        partial: output,
      });
    } else {
      stream.push({
        type: "thinking_end",
        contentIndex: blockIndex(),
        content: currentBlock.thinking,
        partial: output,
      });
    }
    currentBlock = null;
  };

  const handleLine = (line: string) => {
    if (!line.startsWith("data: ")) return;
    const jsonStr = line.slice(6).trim();
    if (!jsonStr || jsonStr === "[DONE]") return;

    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(jsonStr) as StreamChunk;
    } catch {
      return;
    }

    const responseData = chunk.response ?? chunk;
    if (chunk.error) {
      throw new Error(`Antigravity error: ${chunk.error.message || JSON.stringify(chunk.error)}`);
    }

    const candidate = responseData.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    for (const part of parts) {
      if (part.thought) {
        hasContent = true;
        const text = part.text || "";
        if (currentBlock && currentBlock.type !== "thinking") finishCurrent();
        if (!currentBlock) {
          const thinkingBlock = {
            type: "thinking" as const,
            thinking: text,
            ...(part.thoughtSignature ? { thinkingSignature: part.thoughtSignature } : {}),
          };
          blocks.push(thinkingBlock);
          currentBlock = thinkingBlock;
          output.content = blocks as AssistantMessage["content"];
          ensureStarted();
          stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
        } else if (currentBlock.type === "thinking") {
          currentBlock.thinking += text;
        }
        if (text) {
          ensureStarted();
          stream.push({
            type: "thinking_delta",
            contentIndex: blockIndex(),
            delta: text,
            partial: output,
          });
        }
      } else if (part.text !== undefined) {
        hasContent = true;
        if (currentBlock && currentBlock.type !== "text") finishCurrent();
        if (!currentBlock) {
          const textBlock = {
            type: "text" as const,
            text: part.text,
            ...(part.thoughtSignature ? { textSignature: part.thoughtSignature } : {}),
          };
          blocks.push(textBlock);
          currentBlock = textBlock;
          output.content = blocks as AssistantMessage["content"];
          ensureStarted();
          stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
        } else if (currentBlock.type === "text") {
          currentBlock.text += part.text;
        }
        if (part.text) {
          ensureStarted();
          stream.push({
            type: "text_delta",
            contentIndex: blockIndex(),
            delta: part.text,
            partial: output,
          });
        }
      }

      if (part.functionCall) {
        hasContent = true;
        finishCurrent();
        const rawId = part.functionCall.id || "";
        const toolCall: ToolCall = {
          type: "toolCall",
          id: sanitizeToolCallId(rawId, part.functionCall.name),
          name: part.functionCall.name || "",
          arguments: (part.functionCall.args ?? {}) as Record<string, never>,
          ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
        };
        blocks.push(toolCall);
        output.content = blocks as AssistantMessage["content"];
        ensureStarted();
        stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
        stream.push({
          type: "toolcall_delta",
          contentIndex: blockIndex(),
          delta: JSON.stringify(toolCall.arguments),
          partial: output,
        });
        stream.push({
          type: "toolcall_end",
          contentIndex: blockIndex(),
          toolCall,
          partial: output,
        });
      }
    }

    if (candidate?.finishReason) {
      sawFinishReason = true;
      output.stopReason = blocks.some((b) => b.type === "toolCall")
        ? StopReason.ToolUse
        : mapStopReason(candidate.finishReason);
    }

    if (responseData.usageMetadata) {
      const prompt = responseData.usageMetadata.promptTokenCount || 0;
      const cacheRead = responseData.usageMetadata.cachedContentTokenCount || 0;
      const thoughts = responseData.usageMetadata.thoughtsTokenCount || 0;
      output.usage.input = prompt - cacheRead;
      output.usage.output = (responseData.usageMetadata.candidatesTokenCount || 0) + thoughts;
      output.usage.cacheRead = cacheRead;
      output.usage.totalTokens = responseData.usageMetadata.totalTokenCount || 0;
      if (model?.cost) {
        calculateCost(model, output.usage);
      }
    }
  };

  while (true) {
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });

    while (true) {
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx === -1) break;
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      handleLine(line.replace(/\r$/, ""));
    }
  }

  buffer += decoder.decode();
  if (buffer.length > 0) handleLine(buffer.replace(/\r$/, ""));

  if (!sawFinishReason && !output.stopReason) {
    output.stopReason = "stop";
  }

  finishCurrent();
  return hasContent;
}

export function streamAntigravity(
  model: Model<Api>,
  context: Context,
  options?: AntigravityStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const opts = options ?? {};

  void (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      stopReason: "stop",
      model: model.id,
      provider: PROVIDER_ID,
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

    try {
      const creds = parseApiKey(opts.apiKey as string | undefined);
      const warmedProject = creds.projectId ? null : await loadCodeAssist(creds.token);
      const projectId = resolveProjectId({
        token: creds.token,
        warmedProject,
        credentialProjectId: creds.projectId,
      });

      const effort = (opts.reasoning as string) ?? "off";
      const isKnownModel = model.id in ANTIGRAVITY_ROUTING;
      const baseRuntimeModel =
        antigravityEnv("RUNTIME_MODEL")?.trim() || getAntigravityRequestModelId(model.id, effort);

      let initialRuntimeModel = baseRuntimeModel;
      if (!isKnownModel && !antigravityEnv("RUNTIME_MODEL")) {
        const dynamic = await fetchAvailableRuntimeModel(creds.token, projectId, baseRuntimeModel);
        if (dynamic?.id && /^(gemini-|claude-|gpt-oss-)/i.test(dynamic.id)) {
          initialRuntimeModel = dynamic.id;
        }
      }

      const runtimeCandidates = [initialRuntimeModel];
      const fallback = getFallbackRuntimeModel(initialRuntimeModel, effort);
      if (fallback && fallback !== initialRuntimeModel) {
        runtimeCandidates.push(fallback);
      }

      const requestHeaders = antigravityHeaders(creds.token);
      let response: Response | undefined;
      let lastText = "";
      let runtimeModel = initialRuntimeModel;

      for (let emptyAttempt = 0; emptyAttempt <= 2; emptyAttempt++) {
        if (opts.signal?.aborted) throw new Error("Request was aborted");
        if (emptyAttempt > 0) {
          await new Promise((res) => setTimeout(res, 500 * 2 ** (emptyAttempt - 1)));
        }

        for (let candIdx = 0; candIdx < runtimeCandidates.length; candIdx++) {
          runtimeModel = runtimeCandidates[candIdx] ?? initialRuntimeModel;
          const body = JSON.stringify(buildRequest(model, context, projectId, opts, runtimeModel));

          for (const endpoint of endpointCandidates()) {
            response = await fetchWithHeaderDeadline(
              `${endpoint}/v1internal:streamGenerateContent?alt=sse`,
              {
                method: "POST",
                headers: requestHeaders,
                body,
              },
              opts.signal,
            );
            if (response.ok) break;
            lastText = await response.text();
            if (response.status === 429) break;
            if (![403, 404, 429, 500, 502, 503, 504].includes(response.status)) break;
          }

          if (response?.ok) break;
          if (response?.status === 404 && candIdx + 1 < runtimeCandidates.length) {
            continue;
          }
          break;
        }

        if (!response?.ok) {
          const detail = jsonOrTextError(lastText) || response?.statusText || "request failed";
          throw new Error(`Antigravity request failed (${response?.status ?? "unknown"}): ${detail}`);
        }

        const received = await parseSseStream(response, output, stream, model);
        if (received) break;
      }

      const reason = output.stopReason === "toolUse" || output.stopReason === "length" ? output.stopReason : "stop";
      stream.push({ type: "done", reason, message: output });
    } catch (error) {
      if (opts.signal?.aborted) {
        output.stopReason = "aborted";
        stream.push({ type: "error", reason: "aborted", error: output });
        return;
      }
      output.stopReason = "error";
      output.errorMessage = safeError(error);
      stream.push({ type: "error", reason: "error", error: output });
    }
  })();

  return stream;
}
