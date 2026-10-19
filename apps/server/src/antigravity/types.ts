import type { Server } from "node:http";
import type { SimpleStreamOptions, TextContent, ThinkingContent, Tool, ToolCall } from "@earendil-works/pi-ai";

export const GeminiRole = {
  User: "user",
  Model: "model",
} as const;
export type GeminiRole = (typeof GeminiRole)[keyof typeof GeminiRole];

export const ThinkingEffort = {
  Off: "off",
  Minimal: "minimal",
  Low: "low",
  Medium: "medium",
  High: "high",
  Xhigh: "xhigh",
} as const;
export type ThinkingEffort = (typeof ThinkingEffort)[keyof typeof ThinkingEffort];

export const StopReason = {
  EndTurn: "endTurn",
  MaxTokens: "maxTokens",
  ToolUse: "toolUse",
} as const;
export type StopReason = (typeof StopReason)[keyof typeof StopReason];

export const GeminiToolCallingMode = {
  Auto: "AUTO",
  Any: "ANY",
  None: "NONE",
} as const;
export type GeminiToolCallingMode = (typeof GeminiToolCallingMode)[keyof typeof GeminiToolCallingMode];

export const ToolChoice = {
  Auto: "auto",
  Any: "any",
  None: "none",
  Required: "required",
} as const;
export type ToolChoice = (typeof ToolChoice)[keyof typeof ToolChoice];

export type AntigravityApiKey = {
  token: string;
  projectId: string;
};

export type DynamicModelInfo = {
  id: string;
  experiments?: string[];
  apiProvider?: string;
  modelProvider?: string;
  model?: string;
};

export type CallbackServer = {
  server: Server;
  waitForCode: () => Promise<{ code: string; state: string }>;
  cleanup: () => void;
};

export type AntigravityRouting = {
  off?: string;
  routing?: Partial<Record<ThinkingEffort, string>>;
  defaultRequestId?: string;
};

export type AntigravityStreamOptions = Omit<SimpleStreamOptions, "toolChoice"> & {
  toolChoice?: ToolChoice;
  tools?: Tool[];
};

type GeminiTextPart = { text: string; thoughtSignature?: string };
export type GeminiInlineDataPart = { inlineData: { mimeType: string; data: string } };
type GeminiThoughtPart = {
  thought: true;
  text: string;
  thoughtSignature?: string;
};
type GeminiFunctionCallPart = {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
    id?: string;
  };
  thoughtSignature?: string;
};
export type GeminiFunctionResponsePart = {
  functionResponse: {
    name: string;
    response: { error: string } | { output: string };
    id?: string;
  };
};
export type GeminiPart =
  | GeminiTextPart
  | GeminiInlineDataPart
  | GeminiThoughtPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart;

export type GeminiContent = {
  role: GeminiRole;
  parts: GeminiPart[];
};

export type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters?: unknown;
  parametersJsonSchema?: unknown;
};

type GeminiToolConfig = {
  functionCallingConfig: {
    mode: GeminiToolCallingMode;
  };
};

export type ThinkingWire = {
  includeThoughts: boolean;
  thinkingBudget: number;
};

export type GeminiGenerationConfig = {
  temperature?: number;
  maxOutputTokens?: number;
  thinkingConfig?: ThinkingWire;
};

export type GeminiRequestBody = {
  contents: GeminiContent[];
  systemInstruction: {
    role: "user";
    parts: GeminiTextPart[];
  };
  generationConfig?: GeminiGenerationConfig;
  tools?: { functionDeclarations: GeminiFunctionDeclaration[] }[];
  toolConfig?: GeminiToolConfig;
  sessionId?: string;
  labels?: Record<string, string>;
};

export type AntigravityGenerateRequest = {
  project: string;
  model: string;
  request: GeminiRequestBody;
  requestType: "agent";
  userAgent: "antigravity";
  requestId: string;
};

type StreamPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  };
};

type StreamUsageMetadata = {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
};

type StreamCandidate = {
  content?: { parts?: StreamPart[] };
  finishReason?: string;
};

type StreamResponseData = {
  candidates?: StreamCandidate[];
  usageMetadata?: StreamUsageMetadata;
};

export type StreamChunk = StreamResponseData & {
  error?: { message?: string; code?: number };
  response?: StreamResponseData;
};

export type LooseImageBlock = {
  type: "image";
  data?: string;
  mimeType?: string;
  mediaType?: string;
  source?: { data?: string; mediaType?: string };
};

export type ContentBlock = TextContent | ThinkingContent | ToolCall | LooseImageBlock;

type ActiveTextBlock = TextContent;
type ActiveThinkingBlock = ThinkingContent;
export type ActiveBlock = ActiveTextBlock | ActiveThinkingBlock;

type QuotaBucketRaw = {
  bucketId?: unknown;
  displayName?: unknown;
  window?: unknown;
  resetTime?: unknown;
  description?: unknown;
  remainingFraction?: unknown;
};

type QuotaGroupRaw = {
  displayName?: unknown;
  description?: unknown;
  buckets?: QuotaBucketRaw[];
};

export type QuotaSummaryRaw = {
  groups?: QuotaGroupRaw[];
  description?: unknown;
};

type ModelInfoRaw = {
  isInternal?: boolean;
  label?: unknown;
  displayName?: unknown;
  modelName?: unknown;
  model?: unknown;
  quotaInfo?: {
    remainingFraction?: unknown;
    resetTime?: unknown;
  };
  modelProvider?: unknown;
  apiProvider?: unknown;
  supportsThinking?: unknown;
  supportsImages?: unknown;
  recommended?: unknown;
  modelExperiments?: unknown[];
};

export type AvailableModelsRaw = {
  models?: Record<string, ModelInfoRaw>;
  defaultAgentModelId?: unknown;
  defaultAgentModel?: unknown;
};
