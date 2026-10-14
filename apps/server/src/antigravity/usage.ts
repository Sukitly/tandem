import type { UsageWindow } from "@tandem/contracts";
import { antigravityHeaders, endpointCandidates, parseApiKey } from "./client.ts";
import type { AvailableModelsRaw, QuotaSummaryRaw } from "./types.ts";
import { defaultProjectId, isRecord } from "./util.ts";

export interface UsageRead {
  windows: UsageWindow[];
}

function parseTokenAndProject(raw: string): { token: string; projectId: string } {
  try {
    const creds = parseApiKey(raw);
    return { token: creds.token, projectId: creds.projectId };
  } catch {
    return { token: raw.trim(), projectId: defaultProjectId() };
  }
}

function clampFraction(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function parseWindowSeconds(window: string | undefined): number | undefined {
  if (!window) return undefined;
  const matchSeconds = window.match(/^(\d+)s$/);
  if (matchSeconds?.[1]) return Number(matchSeconds[1]);
  const matchHours = window.match(/^(\d+)h$/);
  if (matchHours?.[1]) return Number(matchHours[1]) * 3600;
  const matchDays = window.match(/^(\d+)d$/);
  if (matchDays?.[1]) return Number(matchDays[1]) * 86400;
  return undefined;
}

function normalizeWindowLabel(name: string, windowSeconds?: number): string {
  const lower = name.toLowerCase();
  if (lower.includes("5 hour") || lower.includes("5h") || windowSeconds === 18000) return "5h";
  if (lower.includes("week") || lower.includes("7d") || windowSeconds === 604800) return "7d";
  if (lower.includes("day") || lower.includes("24h") || windowSeconds === 86400) return "24h";
  return name.slice(0, 10);
}

export function normalizeAntigravityUsage(summary: QuotaSummaryRaw): UsageRead {
  const windows: UsageWindow[] = [];
  for (const group of summary.groups ?? []) {
    for (const bucket of group.buckets ?? []) {
      const remaining = clampFraction(bucket.remainingFraction);
      if (remaining === undefined) continue;
      const utilization = Math.max(0, Math.min(100, Math.round((1 - remaining) * 100)));
      const name = typeof bucket.displayName === "string" ? bucket.displayName : "Limit";
      const windowSec =
        parseWindowSeconds(typeof bucket.window === "string" ? bucket.window : undefined) ??
        (name.toLowerCase().includes("week") ? 7 * 86400 : 5 * 3600);
      const label = normalizeWindowLabel(name, windowSec);
      const resetTime = typeof bucket.resetTime === "string" && bucket.resetTime ? bucket.resetTime : undefined;

      windows.push({
        label,
        utilization,
        windowSeconds: windowSec,
        ...(resetTime !== undefined ? { resetsAt: resetTime } : {}),
      });
    }
  }
  return { windows };
}

export async function fetchAntigravityUsage(tokenOrApiKey: string): Promise<UsageRead> {
  const { token, projectId } = parseTokenAndProject(tokenOrApiKey);
  const endpoints = endpointCandidates();

  // Try retrieveUserQuotaSummary first
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${endpoint}/v1internal:retrieveUserQuotaSummary`, {
        method: "POST",
        headers: antigravityHeaders(token),
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = (await res.json()) as QuotaSummaryRaw;
        const read = normalizeAntigravityUsage(data);
        if (read.windows.length > 0) return read;
      }
    } catch {
      // try next
    }
  }

  // Fallback to fetchAvailableModels for free tier quota info
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: antigravityHeaders(token),
        body: JSON.stringify({ project: projectId }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = (await res.json()) as AvailableModelsRaw;
        const models = data.models ?? {};
        const probeModel = models["gemini-3.8-flash"] ?? Object.values(models)[0];
        if (probeModel && isRecord(probeModel.quotaInfo)) {
          const remaining = clampFraction(probeModel.quotaInfo.remainingFraction);
          if (remaining !== undefined) {
            const utilization = Math.max(0, Math.min(100, Math.round((1 - remaining) * 100)));
            const resetTime =
              typeof probeModel.quotaInfo.resetTime === "string" ? probeModel.quotaInfo.resetTime : undefined;
            return {
              windows: [
                {
                  label: "Gemini",
                  utilization,
                  windowSeconds: 5 * 3600,
                  ...(resetTime ? { resetsAt: resetTime } : {}),
                },
              ],
            };
          }
        }
      }
    } catch {
      // continue
    }
  }

  return { windows: [] };
}
