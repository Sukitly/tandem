import { createHash } from "node:crypto";

export function antigravityEnv(name: string): string | undefined {
  return process.env[`ANTIGRAVITY_${name}`] || process.env[`NOAGY_${name}`];
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const ALLOWED_API_HOST_SUFFIXES = [".googleapis.com", ".sandbox.googleapis.com"];

export function resolveCallbackHost(raw = antigravityEnv("CALLBACK_HOST")): string {
  const host = (raw || "127.0.0.1").trim().toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `Unsafe ANTIGRAVITY_CALLBACK_HOST="${host}". Only loopback hosts are allowed: 127.0.0.1, ::1, localhost.`,
    );
  }
  return host === "localhost" ? "127.0.0.1" : host;
}

export function assertSafeApiBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid ANTIGRAVITY_BASE_URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`ANTIGRAVITY_BASE_URL must use https (got ${url.protocol})`);
  }
  if (url.username || url.password) {
    throw new Error("ANTIGRAVITY_BASE_URL must not include credentials");
  }
  const host = url.hostname.toLowerCase();
  const allowed = host === "googleapis.com" || ALLOWED_API_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  if (!allowed) {
    throw new Error(`ANTIGRAVITY_BASE_URL host "${host}" is not allowed. Use a *.googleapis.com endpoint.`);
  }
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path === "/" ? "" : path}`;
}

export function redactSecrets(text: string): string {
  return text
    .replace(/\bya29\.[A-Za-z0-9._~+/-]+=*/g, "[redacted-access-token]")
    .replace(/\b1\/[A-Za-z0-9_-]{20,}/g, "[redacted-refresh-token]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(
      /("?(?:access_token|refresh_token|id_token|token|client_secret|code_verifier|authorization)"?\s*[:=]\s*")[^"]*(")/gi,
      "$1[redacted]$2",
    )
    .replace(
      /("?(?:access_token|refresh_token|id_token|token|client_secret|code_verifier|authorization)"?\s*[:=]\s*)[^\s&,}]+/gi,
      "$1[redacted]",
    );
}

export function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function sanitizeText(text: unknown): string {
  const str = String(text ?? "");
  const toWellFormed = (str as unknown as { toWellFormed?: () => string }).toWellFormed;
  if (typeof toWellFormed === "function") {
    return toWellFormed.call(str);
  }
  return str.replace(/(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/g, "\uFFFD");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stableProjectId(seed: string): string {
  const bytes = createHash("sha1").update(`antigravity:${seed}`).digest().subarray(0, 16);
  const b6 = bytes[6] ?? 0;
  const b8 = bytes[8] ?? 0;
  bytes[6] = (b6 & 0x0f) | 0x50;
  bytes[8] = (b8 & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function defaultProjectId(seed = "antigravity-default"): string {
  return antigravityEnv("PROJECT_ID")?.trim() || stableProjectId(seed);
}

function stableUuid(seed: string): string {
  const bytes = createHash("sha1").update(seed).digest().subarray(0, 16);
  const b6 = bytes[6] ?? 0;
  const b8 = bytes[8] ?? 0;
  bytes[6] = (b6 & 0x0f) | 0x50;
  bytes[8] = (b8 & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toInt64SessionId(seed?: string): string {
  if (seed?.trim()) {
    const s = seed.trim();
    if (/^-?\d+$/.test(s)) {
      const value = BigInt(s);
      if (value >= -(1n << 63n) && value <= (1n << 63n) - 1n) return s;
    }
    const hash = createHash("sha256").update(`antigravity:session:${s}`).digest();
    return String(new DataView(hash.buffer, hash.byteOffset, 8).getBigInt64(0, true));
  }
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return String(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0, true));
}

const sessionTrajectoryMap = new Map<string, { conversationId: string; trajectoryId: string; sessionId: string }>();

export function resolveSessionTrajectory(
  context?: {
    messages?: Array<{ role?: string; timestamp?: number; content?: unknown }>;
  },
  sessionId?: string,
): { conversationId: string; trajectoryId: string; sessionId: string } {
  if (sessionId?.trim()) {
    const seed = `session:${sessionId.trim()}`;
    let entry = sessionTrajectoryMap.get(seed);
    if (!entry) {
      entry = {
        conversationId: stableUuid(`antigravity:conv:${seed}`),
        trajectoryId: stableUuid(`antigravity:traj:${seed}`),
        sessionId: toInt64SessionId(sessionId),
      };
      sessionTrajectoryMap.set(seed, entry);
      if (sessionTrajectoryMap.size > 64) {
        const oldestKey = sessionTrajectoryMap.keys().next().value;
        if (oldestKey !== undefined) sessionTrajectoryMap.delete(oldestKey);
      }
    }
    return entry;
  }

  const messages = context?.messages ?? [];
  const first = messages.find((m) => m?.role === "user" || m?.role === "assistant") || messages[0];
  const role = first?.role || "turn";
  const ts = first?.timestamp ? String(first.timestamp) : "";
  const snippet = typeof first?.content === "string" ? first.content.slice(0, 64) : "";
  const seed = `${role}:${ts}:${snippet}`;

  let entry = sessionTrajectoryMap.get(seed);
  if (!entry) {
    entry = {
      conversationId: stableUuid(`antigravity:conv:${seed}`),
      trajectoryId: stableUuid(`antigravity:traj:${seed}`),
      sessionId: toInt64SessionId(seed),
    };
    sessionTrajectoryMap.set(seed, entry);
    if (sessionTrajectoryMap.size > 64) {
      const oldestKey = sessionTrajectoryMap.keys().next().value;
      if (oldestKey !== undefined) sessionTrajectoryMap.delete(oldestKey);
    }
  }
  return entry;
}

export type AntigravityEnvelopeOptions = {
  isClaude?: boolean;
  isNonGemini?: boolean;
  step?: number;
  lastStepIndex?: string;
  requestIndex?: number;
  userTurnIndex?: number;
  trajectoryId?: string;
  conversationId?: string;
  sessionId?: string;
  lastExecutionId?: string;
  modelEnum?: string;
};

export function antigravityRequestEnvelope(
  wireModelId: string,
  hasTools = false,
  options: AntigravityEnvelopeOptions = {},
): {
  requestId: string;
  sessionId: string;
  labels: Record<string, string>;
} {
  const isClaude = options.isClaude ?? wireModelId.startsWith("claude-");
  const isNonGemini = options.isNonGemini ?? (isClaude || wireModelId.startsWith("gpt-oss-"));
  const agentId = isClaude ? "antigravity-claude" : isNonGemini ? "antigravity-oss" : "antigravity-gemini";
  const step = options.step ?? 1;
  const userTurn = options.userTurnIndex ?? 1;
  const conversationId = options.conversationId || stableUuid(`antigravity:conv:${agentId}`);
  const trajectoryId = options.trajectoryId || stableUuid(`antigravity:traj:${conversationId}`);
  const sessionId = options.sessionId || toInt64SessionId(conversationId);

  const labels: Record<string, string> = {
    agent_id: agentId,
    client_version: "1.2.4",
    client_channel: "stable",
    execution_id: stableUuid(`antigravity:exec:${trajectoryId}:${step}`),
    user_turn_index: String(userTurn),
    request_index: String(options.requestIndex ?? step),
    step_index: String(step),
    last_step_index: options.lastStepIndex ?? String(Math.max(1, step - 1)),
    trajectory_id: trajectoryId,
    conversation_id: conversationId,
    workflow_name: hasTools ? "agentic_tool_use" : "chat",
  };

  if (options.modelEnum) {
    labels.model_enum = options.modelEnum;
  }

  if (step > 1) {
    labels.last_execution_id = options.lastExecutionId || stableUuid(`antigravity:exec:${trajectoryId}:${step - 1}`);
  }

  return {
    requestId: `agent/${agentId}/${Date.now()}/${trajectoryId}/${step}`,
    sessionId,
    labels,
  };
}
