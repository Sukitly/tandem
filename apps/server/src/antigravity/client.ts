import { registerDiscoveredModelEnums, registerModelEnum } from "./models.ts";
import type { AntigravityApiKey, AvailableModelsRaw, DynamicModelInfo } from "./types.ts";
import {
  antigravityEnv,
  asString,
  assertSafeApiBaseUrl,
  defaultProjectId,
  escapeRegExp,
  isRecord,
  safeError,
} from "./util.ts";

const DEFAULT_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const ENDPOINT_FALLBACKS = [
  DEFAULT_ENDPOINT,
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
];

const PROJECT_CACHE_TTL_MS = 30 * 60 * 1000;
const projectCache = new Map<string, { projectId: string | undefined; expiresAt: number }>();

const MODEL_CACHE_TTL_MS = 30 * 60 * 1000;
const modelCache = new Map<string, { result: DynamicModelInfo | undefined; expiresAt: number }>();

const DISCOVERY_TIMEOUT_MS = 8000;
const inFlightModelLookups = new Map<string, Promise<DynamicModelInfo | undefined>>();

export function endpointCandidates(): string[] {
  const explicit = antigravityEnv("BASE_URL")?.trim();
  return explicit ? [assertSafeApiBaseUrl(explicit)] : ENDPOINT_FALLBACKS;
}

const DEFAULT_USER_AGENT =
  "antigravity/cli/1.2.4 (aidev_client; os_type=linux; arch=amd64; cl=982146307; auth_method=consumer)";

function defaultUserAgent(): string {
  return DEFAULT_USER_AGENT;
}

export function antigravityHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": antigravityEnv("USER_AGENT") || defaultUserAgent(),
  };
}

export function jsonOrTextError(text: string): string {
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; status?: string; code?: number };
    };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // not JSON
  }
  return text;
}

export function parseApiKey(apiKeyRaw: string | undefined): AntigravityApiKey {
  if (!apiKeyRaw) {
    throw new Error("No Antigravity credentials available. Please log in.");
  }
  try {
    const parsed = JSON.parse(apiKeyRaw) as Partial<AntigravityApiKey>;
    if (!parsed.token || !parsed.projectId) throw new Error("missing token or projectId");
    return { token: parsed.token, projectId: parsed.projectId };
  } catch (error) {
    throw new Error(`Invalid Antigravity credentials. (${safeError(error)})`, { cause: error });
  }
}

function extractProjectId(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const direct =
    data.antigravityProjectId ??
    data.projectId ??
    data.backendProjectId ??
    data.userDefinedCloudaicompanionProject ??
    data.cloudaicompanionProject ??
    data.project;
  const directId = asString(direct);
  if (directId) return directId;
  if (isRecord(direct)) {
    const nestedId = asString(direct.id);
    if (nestedId) return nestedId;
  }
  for (const key of ["projects", "projectIds", "cloudaicompanionProjects"]) {
    const value = data[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = extractProjectId(item);
        if (nested) return nested;
        const itemId = asString(item);
        if (itemId) return itemId;
      }
    }
  }
  return undefined;
}

async function listCloudAICompanionProjects(token: string): Promise<string | undefined> {
  for (const endpoint of endpointCandidates()) {
    try {
      const res = await fetch(`${endpoint}/v1internal:listCloudAICompanionProjects`, {
        method: "POST",
        headers: antigravityHeaders(token),
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      return extractProjectId(await res.json());
    } catch {
      // ignore
    }
  }
  return undefined;
}

function isUsableRuntimeModelId(id: string): boolean {
  return /^(gemini-|claude-|gpt-oss-)/i.test(id) && !/\s/.test(id) && !/^MODEL_/i.test(id);
}

function buildModelMatchRegex(requestedId: string): RegExp {
  const req = requestedId.toLowerCase();
  if (req === "gemini-3.8-flash-low") return /gemini[- ]3\.8[- ]flash \(low\)/i;
  if (req === "gemini-3.8-flash-medium") return /gemini[- ]3\.8[- ]flash \(medium\)/i;
  if (req === "gemini-3.8-flash-high") return /gemini[- ]3\.8[- ]flash \(high\)/i;
  if (req === "gemini-3.7-flash-low") return /gemini[- ]3\.7[- ]flash \(low\)/i;
  if (req === "gemini-3.7-flash-medium") return /gemini[- ]3\.7[- ]flash \(medium\)/i;
  if (req === "gemini-3.7-flash-high") return /gemini[- ]3\.7[- ]flash \(high\)/i;
  if (req === "gemini-3.6-flash-low") return /gemini[- ]3\.6[- ]flash \(low\)/i;
  if (req === "gemini-3.6-flash-medium") return /gemini[- ]3\.6[- ]flash \(medium\)/i;
  if (req === "gemini-3.6-flash-high") return /gemini[- ]3\.6[- ]flash \(high\)/i;
  if (req === "gemini-3.5-flash-extra-low") return /gemini[- ]3\.5[- ]flash \(low\)/i;
  if (req === "gemini-3.5-flash-low" || req === "gemini-3.5-flash-medium") return /gemini[- ]3\.5[- ]flash \(medium\)/i;
  if (req === "gemini-3.5-flash-high" || req === "gemini-3-flash-agent") return /gemini[- ]3\.5[- ]flash \(high\)/i;
  if (req.includes("claude-opus-4-6")) return /claude.*opus.*4\.6/i;
  if (req.includes("claude-sonnet-4-6")) return /claude.*sonnet.*4\.6/i;
  if (req.includes("gpt-oss-120b")) return /gpt.*oss.*120b/i;
  if (req === "gemini-3.1-pro-low") return /gemini[- ]3\.1[- ]pro \(low\)/i;
  if (req === "gemini-3.1-pro-high" || req === "gemini-pro-agent") return /gemini[- ]3\.1[- ]pro \(high\)/i;
  const escaped = escapeRegExp(req).replace(/\\-/g, "[- ]");
  return new RegExp(escaped, "i");
}

function dynamicModelFromInfo(modelId: string, info: unknown): DynamicModelInfo {
  if (!isRecord(info)) return { id: modelId };
  const experiments = Array.isArray(info.modelExperiments)
    ? info.modelExperiments.filter((item): item is string => typeof item === "string")
    : undefined;
  const modelEnum = asString(info.model);
  if (modelEnum) {
    registerModelEnum(modelId, modelEnum);
  }
  return {
    id: modelId,
    experiments,
    apiProvider: asString(info.apiProvider),
    modelProvider: asString(info.modelProvider),
    model: modelEnum,
  };
}

function findDynamicModel(value: unknown, requestedId: string): DynamicModelInfo | undefined {
  if (!value) return undefined;
  if (isRecord(value) && isRecord(value.models)) {
    const modelsMap = value.models;
    if (isUsableRuntimeModelId(requestedId) && requestedId in modelsMap) {
      return dynamicModelFromInfo(requestedId, modelsMap[requestedId]);
    }
    const targetRegex = buildModelMatchRegex(requestedId);
    for (const [modelId, info] of Object.entries(modelsMap)) {
      if (!isUsableRuntimeModelId(modelId)) continue;
      if (targetRegex.test(modelId)) return dynamicModelFromInfo(modelId, info);
      if (isRecord(info)) {
        const label = info.label ?? info.displayName ?? info.name;
        if (typeof label === "string" && targetRegex.test(label)) {
          return dynamicModelFromInfo(modelId, info);
        }
      }
    }
    return undefined;
  }
  return undefined;
}

export async function fetchAvailableRuntimeModel(
  token: string,
  projectId: string,
  requestedRuntimeModel: string,
): Promise<DynamicModelInfo | undefined> {
  const cacheKey = `${token}::${projectId}::${requestedRuntimeModel}`;
  const cached = modelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const inFlight = inFlightModelLookups.get(cacheKey);
  if (inFlight) return inFlight;

  const lookup = (async (): Promise<DynamicModelInfo | undefined> => {
    const body = JSON.stringify({ project: projectId });
    for (const endpoint of endpointCandidates()) {
      try {
        const res = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
          method: "POST",
          headers: antigravityHeaders(token),
          body,
          signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        });
        if (!res.ok) continue;
        const data: unknown = await res.json();
        if (isRecord(data) && isRecord(data.models)) {
          registerDiscoveredModelEnums(data.models as Record<string, { model?: unknown }>);
        }
        const found = findDynamicModel(data, requestedRuntimeModel);
        if (found) return found;
      } catch {
        // continue
      }
    }
    return undefined;
  })().finally(() => inFlightModelLookups.delete(cacheKey));

  inFlightModelLookups.set(cacheKey, lookup);
  const result = await lookup;
  modelCache.set(cacheKey, { result, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });
  return result;
}

export async function loadCodeAssist(token: string): Promise<string | undefined> {
  const cached = projectCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.projectId;
  }
  const body = JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } });
  let discovered: string | undefined;

  for (const endpoint of endpointCandidates()) {
    try {
      const res = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: antigravityHeaders(token),
        body,
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const project = extractProjectId(await res.json());
      if (project) {
        discovered = project;
        break;
      }
      discovered = await listCloudAICompanionProjects(token);
      if (discovered) break;
    } catch {
      // continue
    }
  }

  projectCache.set(token, { projectId: discovered, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
  return discovered;
}

export function resolveProjectId(options: {
  token: string;
  warmedProject?: string | null;
  credentialProjectId?: string;
}): string {
  if (options.credentialProjectId?.trim()) return options.credentialProjectId.trim();
  if (options.warmedProject?.trim()) return options.warmedProject.trim();
  const cached = projectCache.get(options.token);
  if (cached?.projectId?.trim()) return cached.projectId.trim();
  return defaultProjectId();
}

export async function fetchAvailableModelsCatalog(
  token: string,
  projectId: string,
  signal?: AbortSignal,
): Promise<{ endpoint: string; status: number; data: AvailableModelsRaw }> {
  let lastEndpoint = "";
  let lastStatus = 0;
  const mergedModels: Record<string, unknown> = {};
  let defaultAgentModelId: string | undefined;
  let defaultAgentModel: string | undefined;

  for (const endpoint of endpointCandidates()) {
    try {
      const res = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: antigravityHeaders(token),
        body: JSON.stringify({ project: projectId }),
        signal: signal ?? AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      lastEndpoint = endpoint;
      lastStatus = res.status;
      if (!res.ok) continue;
      const data: unknown = await res.json();
      if (isRecord(data) && isRecord(data.models)) {
        Object.assign(mergedModels, data.models);
        registerDiscoveredModelEnums(data.models as Record<string, { model?: unknown }>);
      }
      if (isRecord(data) && typeof data.defaultAgentModelId === "string") {
        defaultAgentModelId = data.defaultAgentModelId;
      }
      if (isRecord(data) && typeof data.defaultAgentModel === "string") {
        defaultAgentModel = data.defaultAgentModel;
      }
      break;
    } catch {
      // try next
    }
  }

  return {
    endpoint: lastEndpoint,
    status: lastStatus,
    data: {
      models: mergedModels as AvailableModelsRaw["models"],
      defaultAgentModelId,
      defaultAgentModel,
    },
  };
}
