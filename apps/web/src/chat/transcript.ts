import type { ConversationView, PageImageBlock } from "@tandem/contracts";

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
      /** Images the result holds, such as an image file `read` returned. */
      images: PageImageBlock[];
      /** The edit tool's diff of the change it made. */
      diff?: string;
    };

/** What the transcript shows, in order. */
export type TranscriptItem =
  | { kind: "user"; key: string; text: string; images: PageImageBlock[] }
  | {
      kind: "assistant";
      key: string;
      parts: AssistantPart[];
      /** `interrupted`: stopped by the user or by a server restart. `streaming`: still being generated. */
      ending: "complete" | "interrupted" | "failed" | "streaming";
      error?: string;
      /** How many consecutive failure attempts were aggregated into this item. */
      attempts?: number;
      /** Later assistant content followed this failure in the same turn; this does not imply a successful retry. */
      continued?: boolean;
    }
  /** Older messages were summarized from here on; the model sees the summary instead. */
  | { kind: "compaction"; key: string }
  /** A summary of the conversation is being made. */
  | { kind: "compacting"; key: string };

export interface QueuedMessage {
  id: number;
  mode: "steer" | "followUp";
  text: string;
  /** How many images go with it; they have no entry to be fetched from until it is taken. */
  imageCount: number;
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
  /** Busy with nothing on screen moving: no words arriving, no tool running, no summary being made. */
  silent: boolean;
  /** The current turn has shown something since the last user message. */
  turnHasContent: boolean;
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
        items.push({ kind: "user", key, text: textOf(message.content), images: imagesOf(message.content) });
      } else if (message.role === "assistant") {
        const parts = partsOf(message, tool);
        const ending =
          message.stopReason === "aborted" ? "interrupted" : message.stopReason === "error" ? "failed" : "complete";
        const error = message.errorMessage;
        const used = contextTokens(message.usage);
        if (used > 0) tokens = used;

        const prev = items[items.length - 1];
        if (
          prev !== undefined &&
          prev.kind === "assistant" &&
          prev.ending === "failed" &&
          prev.parts.length === 0 &&
          ending === "failed" &&
          parts.length === 0
        ) {
          prev.attempts = (prev.attempts ?? 1) + 1;
          if (error !== undefined) prev.error = error;
          continue;
        }

        items.push({
          kind: "assistant",
          key,
          parts,
          ending,
          ...(error === undefined ? {} : { error }),
        });
      }
    }
  }

  const partial = live?.generation?.message;
  const streaming = busy && partial?.role === "assistant" && partial.content.length > 0;
  if (streaming && partial?.role === "assistant") {
    items.push({
      kind: "assistant",
      key: `streaming:${live?.generation?.attempt ?? 0}`,
      parts: partsOf(partial, tool),
      ending: "streaming",
    });
  }
  // De-emphasize a failed attempt only when later content confirms that the same turn progressed.
  let continued = false;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item?.kind === "user") continued = false;
    else if (item?.kind === "assistant") {
      if (item.ending === "failed" && continued) item.continued = true;
      if ((item.ending === "complete" || item.ending === "streaming") && item.parts.length > 0) continued = true;
    }
  }

  const compacting = (live?.compactions ?? []).length > 0;
  if (compacting) items.push({ kind: "compacting", key: "compacting" });
  const toolsRunning = (live?.tools ?? []).some((slot) => slot.status !== "done");
  const silent = busy && !streaming && !toolsRunning && !compacting;
  const lastUser = items.findLastIndex((item) => item.kind === "user");
  const turnHasContent = items.slice(lastUser + 1).length > 0;

  const inbox = view.docs["pi.inbox"] as InboxDoc | undefined;
  const queued = (inbox?.items ?? []).flatMap((item): QueuedMessage[] =>
    item.mode === "steer" || item.mode === "followUp"
      ? [
          {
            id: item.id,
            mode: item.mode,
            text: textOf(item.content as Message["content"]),
            imageCount: imagesOf(item.content as Message["content"]).length,
          },
        ]
      : [],
  );

  const spend = view.docs["pi.usage"] as UsageDoc | undefined;
  const cost = [...Object.values(spend?.models ?? {}), ...Object.values(spend?.tools ?? {})].reduce(
    (sum, usage) => sum + usage.cost.total,
    0,
  );

  return { items, busy, silent, turnHasContent, queued, usage: { tokens, cost } };
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
            images: result === undefined ? [] : imagesOf(result.content),
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

function imagesOf(content: Message["content"] | undefined): PageImageBlock[] {
  if (content === undefined || typeof content === "string") return [];
  return content.flatMap((block) => (block.type === "image" ? [block as PageImageBlock] : []));
}

function textOf(content: Message["content"] | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}
