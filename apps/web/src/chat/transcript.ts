import type { ConversationView } from "@tandem/contracts";

type Message = NonNullable<ConversationView["entries"][number]["model"]>[number];

/** What the transcript shows, in order. */
export type TranscriptItem =
  | { kind: "user"; key: string; text: string }
  | {
      kind: "assistant";
      key: string;
      text: string;
      /** `interrupted`: stopped by the user or by a server restart. */
      ending: "complete" | "interrupted" | "failed";
      error?: string;
    }
  /** The answer being generated; `text` is empty until the first words arrive. */
  | { kind: "streaming"; key: string; text: string };

export interface QueuedMessage {
  id: number;
  mode: "steer" | "followUp";
  text: string;
}

export interface TranscriptState {
  items: TranscriptItem[];
  /** The agent is working: a new message steers it or waits for it, and Stop is offered. */
  busy: boolean;
  /** Messages sent while the agent was busy, waiting for their turn. */
  queued: QueuedMessage[];
}

interface LiveDoc {
  run?: unknown;
  generation?: { attempt: number; message?: Message };
}

interface InboxDoc {
  items?: { id: number; mode: string; content?: unknown }[];
}

/** Turn the durable view into what the chat renders. */
export function toTranscript(view: ConversationView): TranscriptState {
  const items: TranscriptItem[] = [];
  for (const entry of view.entries) {
    for (const [index, message] of (entry.model ?? []).entries()) {
      const key = `${entry.id}:${index}`;
      if (message.role === "user") {
        items.push({ kind: "user", key, text: textOf(message.content) });
      } else if (message.role === "assistant") {
        items.push({
          kind: "assistant",
          key,
          text: textOf(message.content),
          ending:
            message.stopReason === "aborted" ? "interrupted" : message.stopReason === "error" ? "failed" : "complete",
          ...(message.errorMessage === undefined ? {} : { error: message.errorMessage }),
        });
      }
      // System prompts and tool results are not shown yet.
    }
  }

  const live = view.docs["pi.live"] as LiveDoc | undefined;
  const busy = live?.run !== undefined;
  const generation = live?.generation;
  if (busy && generation !== undefined) {
    const partial = generation.message;
    items.push({
      kind: "streaming",
      key: `streaming:${generation.attempt}`,
      text: partial?.role === "assistant" ? textOf(partial.content) : "",
    });
  }

  const inbox = view.docs["pi.inbox"] as InboxDoc | undefined;
  const queued = (inbox?.items ?? []).flatMap((item): QueuedMessage[] =>
    item.mode === "steer" || item.mode === "followUp"
      ? [{ id: item.id, mode: item.mode, text: textOf(item.content as Message["content"]) }]
      : [],
  );

  return { items, busy, queued };
}

function textOf(content: Message["content"] | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}
