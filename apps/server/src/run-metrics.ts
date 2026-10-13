import type { ConversationView, RunTps } from "@tandem/contracts";

/** One run's tokens, without how long it took. */
export interface RunTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

/**
 * The newest run's token totals: what the answers after the newest user message spent. Only assistant messages count,
 * as in pi's `tps` extension, and `totalTokens` is taken as the provider reported it.
 */
export function lastRunTokens(view: ConversationView): RunTokens | undefined {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let total = 0;
  let answered = false;

  for (const entry of view.entries) {
    if (entry.kind === "pi.user") {
      // A new run: it starts here, and the previous run's numbers are forgotten.
      input = 0;
      output = 0;
      cacheRead = 0;
      cacheWrite = 0;
      total = 0;
      answered = false;
      continue;
    }
    if (entry.kind !== "pi.assistant") continue;
    for (const message of entry.model ?? []) {
      if (message.role !== "assistant") continue;
      input += message.usage.input || 0;
      output += message.usage.output || 0;
      cacheRead += message.usage.cacheRead || 0;
      cacheWrite += message.usage.cacheWrite || 0;
      total += message.usage.totalTokens || 0;
      answered = true;
    }
  }

  return answered
    ? {
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        totalTokens: total,
      }
    : undefined;
}

/**
 * Times a run across its busy edges, as pi's `tps` extension times `agent_start` to `agent_end`. A run is in progress
 * exactly while the conversation's live state holds a run, which the server observes on every revision; the wall clock
 * between the two edges is the run's duration, gaps and backoff included.
 */
export class RunTimer {
  readonly #now: () => number;
  #startedAt: number | undefined;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** Say whether a run is in progress; a run that just ended returns how many seconds it took, once. */
  observe(busy: boolean): number | undefined {
    if (busy) {
      this.#startedAt ??= this.#now();
      return undefined;
    }
    const startedAt = this.#startedAt;
    this.#startedAt = undefined;
    if (startedAt === undefined) return undefined;
    return Math.max(0, (this.#now() - startedAt) / 1000);
  }
}

/** A finished run's throughput, or nothing when it produced no output, as the extension reports nothing then. */
export function runTps(tokens: RunTokens, seconds: number): RunTps | undefined {
  if (tokens.outputTokens <= 0) return undefined;
  return { ...tokens, seconds, tokensPerSecond: seconds > 0 ? tokens.outputTokens / seconds : 0 };
}
