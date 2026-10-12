import {
  type AttachedReplicatedState,
  type Context,
  type ReplicatedStateSource,
  replicatedState,
} from "@earendil-works/chord";
import { diffRevisions } from "@earendil-works/chord/delta";
import type { ConversationId, ConversationView as DurableView, EntryId, Harness } from "@earendil-works/pi-durable";
import type { ConversationView, ImageRef, PageImageBlock } from "@tandem/contracts";

type JsonValue = Parameters<typeof diffRevisions>[0];

/**
 * A conversation's view as pages receive it: pi-durable's, with every image block's data replaced by where to fetch
 * it (`/image/...`), so that a page receives an image only when it shows it, not with every revision of the view.
 * Disposing it leaves `durable` to its owner.
 *
 * Each revision of `durable` is turned into one of this view, and what changed is diffed from the two. Values of
 * pi-durable's view are immutable and share what did not change, so an entry or document turned once is reused while
 * it stays the same object, and the diff passes over it by identity.
 */
export function pageView(
  durable: AttachedReplicatedState<DurableView>,
  onError?: (error: Error) => void,
): AttachedReplicatedState<ConversationView> {
  const entries = new WeakMap<object, unknown>();
  const docs = new WeakMap<object, unknown>();
  const turn = (view: DurableView): ConversationView => {
    const conversationId = view.conversation.id as number;
    return {
      conversation: view.conversation,
      entries: view.entries.map((entry) => cached(entries, entry, () => withRefs(entry, conversationId))),
      docs: Object.fromEntries(
        Object.entries(view.docs).map(([kind, doc]) => [kind, cached(docs, doc, () => withoutData(doc, []))]),
      ),
    } as unknown as ConversationView;
  };

  const source: ReplicatedStateSource<ConversationView> = {
    attach() {
      const initial = turn(durable.value);
      let current = initial;
      let cursor = 0;
      let listener: ((frame: Frame) => void) | undefined;
      const pending: Frame[] = [];
      // Every revision is compared with the last one sent, so a revision delivered twice, or skipped, changes nothing.
      const unsubscribe = durable.subscribe((value, context) => {
        const next = turn(value);
        const ops = diffRevisions(current as unknown as JsonValue, next as unknown as JsonValue);
        if (ops.length === 0) return;
        current = next;
        cursor += 1;
        const frame: Frame = { cursor, value: next, ops, context };
        if (listener === undefined) pending.push(frame);
        else listener(frame);
      });
      return {
        snapshot: { value: initial, cursor: 0 },
        activate(receive) {
          listener = receive;
          for (const frame of pending.splice(0)) receive(frame);
        },
        dispose: unsubscribe,
      };
    },
  };
  return replicatedState(source, onError === undefined ? {} : { onError });
}

interface Frame {
  cursor: number;
  value: ConversationView;
  ops: ReturnType<typeof diffRevisions>;
  context: Context;
}

function cached(cache: WeakMap<object, unknown>, value: unknown, make: () => unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  let turned = cache.get(value);
  if (turned === undefined) {
    turned = make();
    cache.set(value, turned);
  }
  return turned;
}

/** An entry with the images of its messages as references; images elsewhere in it, such as in edits, lose their data. */
function withRefs(entry: DurableView["entries"][number], conversationId: number): unknown {
  const refAt = (path: readonly (string | number)[]): ImageRef | undefined => {
    const [model, messageIndex, content, blockIndex] = path;
    if (
      model !== "model" ||
      content !== "content" ||
      typeof messageIndex !== "number" ||
      typeof blockIndex !== "number"
    )
      return undefined;
    return { conversationId, entryId: entry.id as number, messageIndex, blockIndex };
  };
  return withoutData(entry, [], refAt);
}

/**
 * `value` with every image block (`{type: "image", data}`) replaced by a `PageImageBlock`, at the reference `refAt`
 * gives its path, if any. What holds no image is returned as it is, so unchanged parts stay the same objects.
 */
export function withoutData(
  value: unknown,
  path: (string | number)[],
  refAt?: (path: readonly (string | number)[]) => ImageRef | undefined,
): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item, index) => {
      const turned = withoutData(item, [...path, index], refAt);
      if (turned !== item) changed = true;
      return turned;
    });
    return changed ? items : value;
  }
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (record.type === "image" && typeof record.data === "string") {
    const ref = refAt?.(path);
    const block: PageImageBlock = {
      type: "image",
      mimeType: typeof record.mimeType === "string" ? record.mimeType : "",
      ...(ref === undefined ? {} : { ref }),
    };
    return block;
  }
  let changed = false;
  const fields = Object.entries(record).map(([key, field]) => {
    const turned = withoutData(field, [...path, key], refAt);
    if (turned !== field) changed = true;
    return [key, turned] as const;
  });
  return changed ? Object.fromEntries(fields) : value;
}

/** The image at `ref`, as the conversation's entry stores it; `undefined` when there is no image there. */
export async function storedImage(
  harness: Pick<Harness, "conversation">,
  ref: ImageRef,
  context: Context,
): Promise<{ data: string; mimeType: string } | undefined> {
  const conversation = await harness.conversation(ref.conversationId as ConversationId, context);
  if (conversation === undefined) return undefined;
  const entryId = ref.entryId as EntryId;
  const page = await conversation.entries({ minEntryId: entryId, maxEntryId: entryId }, 1, undefined, context);
  const entry = page.items[0];
  if (entry?.id !== entryId) return undefined;
  const message = entry.model?.[ref.messageIndex];
  if (message === undefined || message.role === "assistant" || typeof message.content === "string") return undefined;
  const block = message.content[ref.blockIndex];
  return block?.type === "image" ? { data: block.data, mimeType: block.mimeType } : undefined;
}
