import type { ConversationView } from "@tandem/contracts";

type Message = NonNullable<ConversationView["entries"][number]["model"]>[number];
type AssistantMessage = Extract<Message, { role: "assistant" }>;
type ToolResultMessage = Extract<Message, { role: "toolResult" }>;
type Usage = AssistantMessage["usage"];

export type ToolStatus = "pending" | "running" | "done" | "failed" | "cancelled";

/** One block of an assistant message, in the order the model produced it. */
export type AssistantPart =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | {
      kind: "tool";
      callId: string;
      name: string;
      args: Record<string, unknown>;
      status: ToolStatus;
      /** Running output while it runs, then the result's text. */
      output: string;
      /** The edit tool's diff of the change it made. */
      diff?: string;
    };

/** What the transcript shows, in order. */
export type TranscriptItem =
  | { kind: "user"; key: string; text: string }
  | {
      kind: "assistant";
      key: string;
      parts: AssistantPart[];
      /** `interrupted`: stopped by the user or by a server restart. `streaming`: still being generated. */
      ending: "complete" | "interrupted" | "failed" | "streaming";
      error?: string;
    }
  /** Older messages were summarized from here on; the model sees the summary instead. */
  | { kind: "compaction"; key: string }
  /** The agent is at work but has nothing to show yet, or is summarizing the conversation. */
  | { kind: "working"; key: string; label: string };

export interface QueuedMessage {
  id: number;
  mode: "steer" | "followUp";
  text: string;
}

export interface ContextUsage {
  /** Tokens the last answer's request used, which is how much of the context window is filled. */
  tokens: number;
  /** Total spend of the conversation, in US dollars. */
  cost: number;
}

export interface TranscriptState {
  items: TranscriptItem[];
  /** The agent is working: a new message steers it or waits for it, and Stop is offered. */
  busy: boolean;
  /** Messages sent while the agent was busy, waiting for their turn. */
  queued: QueuedMessage[];
  usage: ContextUsage;
}

interface ToolSlot {
  callId: string;
  status: "pending" | "running" | "done";
  output?: string;
}

interface LiveDoc {
  run?: unknown;
  generation?: { attempt: number; message?: Message };
  tools?: ToolSlot[];
  compactions?: unknown[];
}

interface InboxDoc {
  items?: { id: number; mode: string; content?: unknown }[];
}

interface UsageDoc {
  models?: Record<string, Usage>;
  tools?: Record<string, Usage>;
}

/** Turn the durable view into what the chat renders. */
export function toTranscript(view: ConversationView): TranscriptState {
  const live = view.docs["pi.live"] as LiveDoc | undefined;
  const busy = live?.run !== undefined;
  const slots = new Map((live?.tools ?? []).map((slot) => [slot.callId, slot]));
  const results = new Map<string, ToolResultMessage>();
  for (const entry of view.entries) {
    for (const message of entry.model ?? [])
      if (message.role === "toolResult") results.set(message.toolCallId, message);
  }
  const tool = { busy, slots, results };

  const items: TranscriptItem[] = [];
  let tokens = 0;
  for (const entry of view.entries) {
    if (entry.kind === "pi.compaction") {
      items.push({ kind: "compaction", key: String(entry.id) });
      // The next answer reports how much the summary left.
      tokens = 0;
      continue;
    }
    if (entry.kind !== "pi.user" && entry.kind !== "pi.assistant") continue;
    for (const [index, message] of (entry.model ?? []).entries()) {
      const key = `${entry.id}:${index}`;
      if (message.role === "user") {
        items.push({ kind: "user", key, text: textOf(message.content) });
      } else if (message.role === "assistant") {
        items.push({
          kind: "assistant",
          key,
          parts: partsOf(message, tool),
          ending:
            message.stopReason === "aborted" ? "interrupted" : message.stopReason === "error" ? "failed" : "complete",
          ...(message.errorMessage === undefined ? {} : { error: message.errorMessage }),
        });
        const used = contextTokens(message.usage);
        if (used > 0) tokens = used;
      }
    }
  }

  const partial = live?.generation?.message;
  if (busy && partial?.role === "assistant" && partial.content.length > 0) {
    items.push({
      kind: "assistant",
      key: `streaming:${live?.generation?.attempt ?? 0}`,
      parts: partsOf(partial, tool),
      ending: "streaming",
    });
  } else if (busy && !(live?.tools ?? []).some((slot) => slot.status !== "done")) {
    items.push({ kind: "working", key: "working", label: "Working" });
  }
  if ((live?.compactions ?? []).length > 0) {
    items.push({ kind: "working", key: "compacting", label: "Compacting the conversation" });
  }

  const inbox = view.docs["pi.inbox"] as InboxDoc | undefined;
  const queued = (inbox?.items ?? []).flatMap((item): QueuedMessage[] =>
    item.mode === "steer" || item.mode === "followUp"
      ? [{ id: item.id, mode: item.mode, text: textOf(item.content as Message["content"]) }]
      : [],
  );

  const spend = view.docs["pi.usage"] as UsageDoc | undefined;
  const cost = [...Object.values(spend?.models ?? {}), ...Object.values(spend?.tools ?? {})].reduce(
    (sum, usage) => sum + usage.cost.total,
    0,
  );

  return { items, busy, queued, usage: { tokens, cost } };
}

function partsOf(
  message: AssistantMessage,
  tool: { busy: boolean; slots: Map<string, ToolSlot>; results: Map<string, ToolResultMessage> },
): AssistantPart[] {
  return message.content.flatMap((block): AssistantPart[] => {
    switch (block.type) {
      case "text":
        return block.text === "" ? [] : [{ kind: "text", text: block.text }];
      case "thinking":
        return block.thinking === "" || block.redacted === true ? [] : [{ kind: "thinking", text: block.thinking }];
      case "toolCall": {
        const result = tool.results.get(block.id);
        const slot = tool.slots.get(block.id);
        const details = result?.details as { diff?: unknown } | undefined;
        let status: ToolStatus;
        if (result !== undefined) status = result.isError ? "failed" : "done";
        else if (slot !== undefined) status = slot.status === "done" ? "done" : slot.status;
        else status = tool.busy ? "pending" : "cancelled";
        return [
          {
            kind: "tool",
            callId: block.id,
            name: block.name,
            args: block.arguments as Record<string, unknown>,
            status,
            output: result !== undefined ? textOf(result.content) : (slot?.output ?? ""),
            ...(typeof details?.diff === "string" ? { diff: details.diff } : {}),
          },
        ];
      }
      default:
        return [];
    }
  });
}

/** As pi's coding agent counts it: the provider's total, else the sum of its parts. */
function contextTokens(usage: Usage | undefined): number {
  if (usage === undefined) return 0;
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function textOf(content: Message["content"] | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}
