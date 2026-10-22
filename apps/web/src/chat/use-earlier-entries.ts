import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation, ConversationView } from "@tandem/contracts";
import { useCallback, useRef, useState } from "react";
import { reportFailure } from "@/lib/errors.ts";
import { compactionHead } from "./transcript.ts";

type Entry = ConversationView["entries"][number];

export interface EarlierEntries {
  /** What has been fetched, oldest first. */
  entries: readonly Entry[];
  /** Whether there may be entries before the first of those. False once the server has said there are none. */
  more: boolean;
  loading: boolean;
  /** Fetch the page before the ones fetched. */
  load: () => void;
}

interface Loaded {
  /** Which compaction these came before, in which conversation: a later one replaces more, so they start over. */
  key: string;
  entries: readonly Entry[];
  more: boolean;
}

/**
 * The entries a compaction took out of the view, fetched a page at a time as the person asks for them. `undefined`
 * while there is no compaction to have taken any.
 */
export function useEarlierEntries(
  conversation: Conversation,
  view: ConversationView | undefined,
): EarlierEntries | undefined {
  const [loaded, setLoaded] = useState<Loaded>();
  const [loading, setLoading] = useState(false);
  // State is the old value until the next render, so two calls before it would both go through.
  const fetching = useRef(false);
  const head = view === undefined ? undefined : compactionHead(view);
  const key = view === undefined || head === undefined ? undefined : `${view.conversation.id}:${head.id}`;
  const current = loaded?.key === key ? loaded : undefined;
  const oldest = current?.entries[0]?.id ?? head?.firstKept;

  const load = useCallback(() => {
    if (key === undefined || oldest === undefined || fetching.current) return;
    fetching.current = true;
    setLoading(true);
    conversation
      .history({ before: oldest }, BACKGROUND_CONTEXT)
      .then((page) =>
        setLoaded((previous) => ({
          key,
          entries: [...page.entries, ...(previous?.key === key ? previous.entries : [])],
          more: page.more,
        })),
      )
      .catch((error: unknown) => reportFailure("Could not load earlier messages", error))
      .finally(() => {
        fetching.current = false;
        setLoading(false);
      });
  }, [conversation, key, oldest]);

  if (key === undefined) return undefined;
  return { entries: current?.entries ?? [], more: current?.more ?? true, loading, load };
}
