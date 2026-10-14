import { type MutableReplicatedState, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { MutableModels } from "@earendil-works/pi-ai";
import type { ProviderUsage, UsageState, UsageWindow } from "@tandem/contracts";
import { fetchAntigravityUsage } from "../antigravity/usage.ts";
import { invalidInput } from "./errors.ts";

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const FIVE_HOURS_SECONDS = 5 * HOUR_SECONDS;
const SEVEN_DAYS_SECONDS = 7 * DAY_SECONDS;

/** How long a read stands before another one is made, unless the last one failed. */
const MIN_REFRESH_GAP_MS = 3 * 60 * 1000;

const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

/** A native OpenAI subscription has no quota API; the page is pointed at the account instead. */
export const OPENAI_SUBSCRIPTION_NOTICE =
  "OpenAI subscription: quota query unavailable — https://chatgpt.com/settings/usage";

/** The providers this board can say anything about. */
const SUPPORTED = new Set(["anthropic", "openai-codex", "openai", "antigravity"]);

/** What one provider's usage endpoint returned, normalized. */
export interface UsageRead {
  windows: UsageWindow[];
}

interface AnthropicBucket {
  utilization: number;
  resets_at: string | null;
}

interface AnthropicUsageResponse {
  five_hour: AnthropicBucket | null;
  seven_day: AnthropicBucket | null;
  seven_day_opus: AnthropicBucket | null;
}

interface CodexWindow {
  used_percent: number;
  reset_at: number;
  limit_window_seconds?: number;
}

interface CodexRateLimit {
  primary_window?: CodexWindow | null;
  secondary_window?: CodexWindow | null;
}

interface CodexUsageResponse {
  rate_limit?: CodexRateLimit | null;
}

/**
 * Every provider's usage, read with the server's credentials and shared by every page. A read is cached for a few
 * minutes; a failure is kept as a message beside whatever was read before, so a stale bar is never mistaken for a
 * fresh one.
 */
export class UsageBoard {
  readonly #state: MutableReplicatedState<UsageState>;
  readonly #models: Pick<MutableModels, "getAuth" | "checkAuth">;
  readonly #refreshes = new Map<string, Promise<void>>();
  readonly #onError: (error: Error) => void;

  constructor(models: Pick<MutableModels, "getAuth" | "checkAuth">, onError: (error: Error) => void = () => {}) {
    this.#models = models;
    this.#onError = onError;
    this.#state = replicatedState<UsageState>({ providers: {} });
  }

  get state(): MutableReplicatedState<UsageState> {
    return this.#state;
  }

  /** Read `provider`'s usage; `force` reads even when a recent successful one stands. */
  async refresh(provider: string, force: boolean): Promise<void> {
    if (typeof provider !== "string" || provider === "") throw invalidInput("provider must be a string");
    if (!SUPPORTED.has(provider)) return;
    const known = this.#state.value.providers[provider];
    if (
      !force &&
      known !== undefined &&
      known.error === undefined &&
      (known.refreshedAt ?? 0) + MIN_REFRESH_GAP_MS > Date.now()
    )
      return;
    const running = this.#refreshes.get(provider);
    if (running !== undefined) return running;
    const refresh = this.#read(provider).finally(() => this.#refreshes.delete(provider));
    this.#refreshes.set(provider, refresh);
    await refresh;
  }

  async #read(provider: string): Promise<void> {
    try {
      const auth = await this.#models.getAuth(provider);
      const token = auth?.auth.apiKey;
      if (token === undefined || token === "") throw new Error("No API credentials available; please log in");
      if (provider === "openai") {
        // A native OpenAI subscription has no quota API; an API key needs no widget at all.
        const check = await this.#models.checkAuth(provider);
        this.#publish(
          provider,
          check?.type === "oauth" ? { provider, windows: [], notice: OPENAI_SUBSCRIPTION_NOTICE } : undefined,
        );
        return;
      }
      const read = await fetchUsage(provider, token);
      const windows = read?.windows ?? [];
      this.#publish(provider, { provider, windows, refreshedAt: Date.now() });
    } catch (error) {
      const previous = this.#state.value.providers[provider];
      this.#publish(provider, {
        provider,
        windows: previous?.windows ?? [],
        ...(previous?.notice === undefined ? {} : { notice: previous.notice }),
        error: formatUsageError(error),
        ...(previous?.refreshedAt === undefined ? {} : { refreshedAt: previous.refreshedAt }),
      });
      this.#onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Replace what is known of `provider`; `undefined` forgets it, as when an API-key OpenAI hides the widget. */
  #publish(provider: string, usage: ProviderUsage | undefined): void {
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      if (usage === undefined) delete draft.providers[provider];
      else draft.providers[provider] = usage;
    });
  }
}

/** Read one provider's usage; `null` for a provider with no usage endpoint. */
export async function fetchUsage(provider: string, token: string): Promise<UsageRead | null> {
  if (provider === "anthropic") return fetchAnthropicUsage(token);
  if (provider === "openai-codex") return fetchCodexUsage(token);
  if (provider === "antigravity") return fetchAntigravityUsage(token);
  return null;
}

async function fetchAnthropicUsage(token: string): Promise<UsageRead> {
  const response = await fetch(ANTHROPIC_USAGE_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
    signal: AbortSignal.timeout(10_000),
  });
  return normalizeAnthropicUsage((await requireUsageResponse(response)) as AnthropicUsageResponse);
}

async function fetchCodexUsage(token: string): Promise<UsageRead> {
  const accountId = extractCodexAccountId(token);
  if (accountId === null) throw new Error("Missing ChatGPT account ID in Codex credentials; please log in again");
  const response = await fetch(CODEX_USAGE_URL, {
    method: "GET",
    headers: {
      Accept: "*/*",
      Authorization: `Bearer ${token}`,
      "chatgpt-account-id": accountId,
      originator: "pi",
      "User-Agent": `tandem (${process.platform})`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  return normalizeCodexUsage((await requireUsageResponse(response)) as CodexUsageResponse);
}

export function normalizeAnthropicUsage(data: AnthropicUsageResponse): UsageRead {
  const windows: UsageWindow[] = [];
  if (data.five_hour)
    windows.push({
      label: "5h",
      utilization: data.five_hour.utilization,
      windowSeconds: FIVE_HOURS_SECONDS,
      ...resetOf(data.five_hour.resets_at),
    });
  if (data.seven_day)
    windows.push({
      label: "7d",
      utilization: data.seven_day.utilization,
      windowSeconds: SEVEN_DAYS_SECONDS,
      ...resetOf(data.seven_day.resets_at),
    });
  return { windows };
}

export function normalizeCodexUsage(data: CodexUsageResponse): UsageRead {
  const rateLimit = data.rate_limit;
  if (!rateLimit) return { windows: [] };
  return {
    windows: [
      normalizeCodexWindow(rateLimit.primary_window, FIVE_HOURS_SECONDS),
      normalizeCodexWindow(rateLimit.secondary_window, SEVEN_DAYS_SECONDS),
    ].filter((window): window is UsageWindow => window !== null),
  };
}

function normalizeCodexWindow(
  window: CodexWindow | null | undefined,
  fallbackWindowSeconds: number,
): UsageWindow | null {
  if (!window || !Number.isFinite(window.used_percent)) return null;
  const windowSeconds =
    typeof window.limit_window_seconds === "number" &&
    Number.isFinite(window.limit_window_seconds) &&
    window.limit_window_seconds > 0
      ? window.limit_window_seconds
      : fallbackWindowSeconds;
  return {
    label: formatWindowDuration(windowSeconds),
    utilization: window.used_percent,
    windowSeconds,
    ...resetOf(unixSecondsToIso(window.reset_at)),
  };
}

function resetOf(resetsAt: string | null): { resetsAt?: string } {
  return resetsAt === null ? {} : { resetsAt };
}

/** `7d`, `5h`, `30m`, `45s`: the window's length, when the provider names its own. */
export function formatWindowDuration(seconds: number): string {
  if (seconds >= DAY_SECONDS && seconds % DAY_SECONDS === 0) return `${seconds / DAY_SECONDS}d`;
  if (seconds >= HOUR_SECONDS && seconds % HOUR_SECONDS === 0) return `${seconds / HOUR_SECONDS}h`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function unixSecondsToIso(timestamp: number | null | undefined): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  return new Date(timestamp * 1000).toISOString();
}

/** The `chatgpt_account_id` claim of a Codex token, which the usage endpoint needs. */
export function extractCodexAccountId(token: string): string | null {
  const payload = decodeJwtPayload(token);
  const auth = payload?.["https://api.openai.com/auth"];
  if (!auth || typeof auth !== "object") return null;
  const accountId = (auth as { chatgpt_account_id?: unknown }).chatgpt_account_id;
  return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[1] === undefined) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A message a page may show: secrets and control characters are taken out, and it is kept short. */
export function formatUsageError(error: unknown): string {
  let message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (error instanceof Error && error.cause instanceof Error) message += ` (${error.cause.message})`;
  message = message
    .replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [redacted]")
    .replace(/sk-[\w-]+/g, "[redacted]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted]")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this strips.
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

async function requireUsageResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
      try {
        const body = JSON.parse(detail);
        const message = body?.error?.message ?? body?.message ?? body?.error;
        if (typeof message === "string") detail = message;
      } catch {
        /* Non-JSON error responses are useful too. */
      }
    } catch {
      /* Keep the HTTP status even if reading the body fails. */
    }
    throw new Error(`HTTP ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error("Invalid usage JSON response", { cause: error });
  }
}
