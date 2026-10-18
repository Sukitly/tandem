import type { CommentAnchor } from "@tandem/contracts";
import { createStore } from "zustand/vanilla";
import { TextDraft } from "@/app/text-draft.ts";

export type CommentSide = "additions" | "deletions";
export type DraftLines = Partial<Record<CommentSide, ReadonlyMap<number, string>>>;
export interface AnchoredDraft {
  readonly id: number;
  readonly workspaceId: number;
  readonly anchor: CommentAnchor;
  readonly source: { readonly kind: "file" | "diff"; readonly snapshot: symbol };
  readonly text: TextDraft;
}

/** Unsaved comments have identities independent of changing line numbers and renderer mount cycles. */
export class CommentDrafts {
  #next = 0;
  readonly #store = createStore<readonly AnchoredDraft[]>(() => []);
  #disposed = false;
  getSnapshot = (): readonly AnchoredDraft[] => this.#store.getState();
  subscribe = (listener: () => void): (() => void) => (this.#disposed ? () => {} : this.#store.subscribe(listener));
  create(
    workspaceId: number,
    anchor: CommentAnchor,
    source: { kind: "file" | "diff"; snapshot: DraftLines },
  ): AnchoredDraft {
    if (this.#disposed) throw new Error("Comment draft store is disposed");
    const record = {
      id: ++this.#next,
      workspaceId,
      anchor: { ...anchor, before: [...anchor.before], after: [...anchor.after] },
      source: { kind: source.kind, snapshot: identity(source.snapshot) },
      text: new TextDraft(),
    };
    this.#store.setState([...this.#store.getState(), record], true);
    return record;
  }
  forget(record: AnchoredDraft): void {
    if (!this.#store.getState().includes(record)) return;
    this.#store.setState(
      this.#store.getState().filter((entry) => entry !== record),
      true,
    );
    record.text.dispose();
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const record of this.#store.getState()) record.text.dispose();
    this.#store.setState([], true);
  }
}

// Drafts retain only a token, never the full file or patch maps from a superseded snapshot.
const identities = new WeakMap<DraftLines, symbol>();
function identity(snapshot: DraftLines): symbol {
  let token = identities.get(snapshot);
  if (token === undefined) {
    token = Symbol("comment snapshot");
    identities.set(snapshot, token);
  }
  return token;
}

/** Never break ties by distance: an unsaved comment must not silently attach to a different occurrence. */
export function locateDraft(
  record: AnchoredDraft,
  snapshot: DraftLines,
  candidates?: Iterable<number>,
): number | undefined {
  const anchor = record.anchor;
  const lines = snapshot[anchor.side ?? "additions"];
  if (lines === undefined) return undefined;
  if (record.source.snapshot === identity(snapshot) && lines.get(anchor.line) === anchor.quote) return anchor.line;
  if (anchor.quote.trim() === "" && anchor.before.length + anchor.after.length === 0) return undefined;
  let found: number | undefined;
  for (const line of candidates ?? lines.keys()) {
    if (lines.get(line) !== anchor.quote) continue;
    if (!anchor.before.every((value, index) => lines.get(line - anchor.before.length + index) === value)) continue;
    if (!anchor.after.every((value, index) => lines.get(line + 1 + index) === value)) continue;
    if (found !== undefined) return undefined;
    found = line;
  }
  return found;
}
