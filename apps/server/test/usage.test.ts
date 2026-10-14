import type { MutableModels } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  extractCodexAccountId,
  formatUsageError,
  formatWindowDuration,
  normalizeAnthropicUsage,
  normalizeCodexUsage,
  OPENAI_SUBSCRIPTION_NOTICE,
  UsageBoard,
} from "../src/services/usage.ts";

afterEach(() => vi.unstubAllGlobals());

/** A board over a fixed auth, with the network stubbed by each test. */
function board(
  auth: { apiKey?: string } | undefined,
  type: "oauth" | "api_key" | undefined,
  onError: (error: Error) => void = () => {},
): UsageBoard {
  const models = {
    getAuth: async () => (auth === undefined ? undefined : { auth }),
    checkAuth: async () => (type === undefined ? undefined : { type }),
  } as unknown as Pick<MutableModels, "getAuth" | "checkAuth">;
  return new UsageBoard(models, onError);
}

describe("reading usage", () => {
  test("anthropic windows carry their reset times", () => {
    const read = normalizeAnthropicUsage({
      five_hour: { utilization: 42, resets_at: "2026-01-01T14:30:00.000Z" },
      seven_day: { utilization: 31, resets_at: null },
      seven_day_opus: null,
    });
    expect(read.windows).toEqual([
      { label: "5h", utilization: 42, windowSeconds: 5 * 3600, resetsAt: "2026-01-01T14:30:00.000Z" },
      { label: "7d", utilization: 31, windowSeconds: 7 * 86400 },
    ]);
  });

  test("codex windows take the provider's own duration", () => {
    const read = normalizeCodexUsage({
      rate_limit: {
        primary_window: { used_percent: 10, reset_at: 1_767_000_000, limit_window_seconds: 1800 },
        secondary_window: { used_percent: 20, reset_at: 1_767_000_000 },
      },
    });
    expect(read.windows).toEqual([
      { label: "30m", utilization: 10, windowSeconds: 1800, resetsAt: "2025-12-29T09:20:00.000Z" },
      { label: "7d", utilization: 20, windowSeconds: 7 * 86400, resetsAt: "2025-12-29T09:20:00.000Z" },
    ]);
  });

  test("a codex token's account id is read from its payload", () => {
    const payload = Buffer.from(
      JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_123" } }),
    ).toString("base64url");
    expect(extractCodexAccountId(`header.${payload}.signature`)).toBe("acc_123");
    expect(extractCodexAccountId("not-a-jwt")).toBeNull();
  });

  test("window durations read as the provider names them", () => {
    expect(formatWindowDuration(5 * 3600)).toBe("5h");
    expect(formatWindowDuration(7 * 86400)).toBe("7d");
    expect(formatWindowDuration(1800)).toBe("30m");
    expect(formatWindowDuration(45)).toBe("45s");
  });
});

describe("usage failures", () => {
  test("a message carries no secret and no control characters", () => {
    const message = formatUsageError(
      new Error("HTTP 401 Unauthorized: Bearer eyJhbGciOi.sig.nature and sk-abcd1234\u0007"),
    );
    expect(message).not.toContain("eyJhbGciOi");
    expect(message).not.toContain("sk-abcd1234");
    expect(message).toContain("[redacted]");
    expect(message).not.toContain("\u0007");
  });
});

describe("the usage board", () => {
  test("reads a provider, keeps the windows, and remembers when it read", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ five_hour: { utilization: 42, resets_at: null }, seven_day: null }), {
          status: 200,
        }),
    );
    const usage = board({ apiKey: "token" }, "oauth");
    await usage.refresh("anthropic", true);
    const anthropic = usage.state.value.providers.anthropic;
    expect(anthropic?.windows).toEqual([{ label: "5h", utilization: 42, windowSeconds: 5 * 3600 }]);
    expect(anthropic?.refreshedAt).toBeGreaterThan(0);
  });

  test("keeps the last windows and reports why a later read failed", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ five_hour: { utilization: 42, resets_at: null }, seven_day: null }), {
          status: 200,
        }),
    );
    const errors: Error[] = [];
    const usage = board({ apiKey: "token" }, "oauth", (error) => errors.push(error));
    await usage.refresh("anthropic", true);
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500, statusText: "Server Error" }));
    // A read after a failure is not held back by the cache gap; this one is forced anyway.
    await usage.refresh("anthropic", true);
    const anthropic = usage.state.value.providers.anthropic;
    expect(anthropic?.windows).toEqual([{ label: "5h", utilization: 42, windowSeconds: 5 * 3600 }]);
    expect(anthropic?.error).toContain("500");
    expect(errors).toHaveLength(1);
  });

  test("reads antigravity quota windows through the usage board", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            groups: [
              {
                displayName: "Gemini",
                buckets: [
                  {
                    displayName: "5 hours",
                    window: "18000s",
                    remainingFraction: 0.75,
                    resetTime: "2026-04-01T12:00:00Z",
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const usage = board({ apiKey: JSON.stringify({ token: "tok", projectId: "proj" }) }, "oauth");
    await usage.refresh("antigravity", true);
    const antigravity = usage.state.value.providers.antigravity;
    expect(antigravity?.windows).toEqual([
      { label: "5h", utilization: 25, windowSeconds: 18000, resetsAt: "2026-04-01T12:00:00Z" },
    ]);
    expect(antigravity?.refreshedAt).toBeGreaterThan(0);
  });

  test("a native OpenAI subscription shows a notice, and an API key shows nothing", async () => {
    const usage = board({ apiKey: "token" }, "oauth");
    await usage.refresh("openai", true);
    expect(usage.state.value.providers.openai?.notice).toBe(OPENAI_SUBSCRIPTION_NOTICE);

    const apiKey = board({ apiKey: "token" }, "api_key");
    await apiKey.refresh("openai", true);
    expect(apiKey.state.value.providers.openai).toBeUndefined();
  });

  test("a provider with no usage endpoint is left alone", async () => {
    const usage = board({ apiKey: "token" }, "api_key");
    await usage.refresh("deepseek", true);
    expect(usage.state.value.providers.deepseek).toBeUndefined();
  });
});
