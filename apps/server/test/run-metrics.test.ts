import type { ConversationView } from "@tandem/contracts";
import { describe, expect, test } from "vitest";
import { lastRunTokens, RunTimer, runTps } from "../src/run-metrics.ts";

type Message = NonNullable<ConversationView["entries"][number]["model"]>[number];

/** One assistant message with usage, as the model records it. */
function assistant(usage: {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
}): Message {
  return {
    role: "assistant",
    usage: {
      input: usage.input ?? 0,
      output: usage.output ?? 1,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      totalTokens: usage.totalTokens ?? 0,
    },
  } as unknown as Message;
}

/** A view holding just these entries, which is all the token computation reads. */
function view(entries: { kind: string; model: Message[] }[]): ConversationView {
  return { conversation: {}, entries, docs: {} } as unknown as ConversationView;
}

function user(text: string): { kind: string; model: Message[] } {
  return { kind: "pi.user", model: [{ role: "user", content: text } as Message] };
}

describe("the last run's tokens", () => {
  test("count only the assistant messages, and only since the newest user message", () => {
    const withSeveral = view([
      user("one"),
      { kind: "pi.assistant", model: [assistant({ input: 100, output: 100, totalTokens: 200 })] },
      user("two"),
      {
        kind: "pi.assistant",
        model: [assistant({ input: 10, output: 5, cacheRead: 80, cacheWrite: 10, totalTokens: 105 })],
      },
    ]);
    expect(lastRunTokens(withSeveral)).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
      totalTokens: 105,
    });
  });

  test("are nothing before an answer", () => {
    expect(lastRunTokens(view([]))).toBeUndefined();
    expect(lastRunTokens(view([user("hi")]))).toBeUndefined();
  });
});

describe("timing a run", () => {
  test("measures the wall clock between the run's busy edges", () => {
    let now = 1_000;
    const timer = new RunTimer(() => now);
    expect(timer.observe(false)).toBeUndefined();
    expect(timer.observe(true)).toBeUndefined();
    now = 4_500;
    expect(timer.observe(true)).toBeUndefined();
    now = 11_000;
    expect(timer.observe(false)).toBe(10);
    // The next idle revision is not a second run.
    expect(timer.observe(false)).toBeUndefined();
  });

  test("a run with no output reports nothing", () => {
    const tokens = { inputTokens: 10, outputTokens: 0, cacheReadTokens: 5, cacheWriteTokens: 0, totalTokens: 15 };
    expect(runTps(tokens, 5)).toBeUndefined();
  });

  test("tokens a second divide the output by the measured seconds", () => {
    const tokens = { inputTokens: 20, outputTokens: 10, cacheReadTokens: 90, cacheWriteTokens: 100, totalTokens: 220 };
    expect(runTps(tokens, 2)).toEqual({ ...tokens, seconds: 2, tokensPerSecond: 5 });
  });
});
