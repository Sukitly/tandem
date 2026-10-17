import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CommentDrafts } from "@/comments/comment-drafts.ts";
import { MessageDraft } from "./message-draft.ts";
import { TextDraft } from "./text-draft.ts";

/** Page-owned drafts. Moving a message never replaces an object held by a subscriber. */
export class Drafts {
  readonly comments = new CommentDrafts();
  readonly #messages = new Map<string, MessageDraft>();
  readonly #texts = new Map<string, TextDraft>();
  #disposed = false;

  message(key: string, initial = ""): MessageDraft {
    if (this.#disposed) throw new Error("Draft store is disposed");
    let draft = this.#messages.get(key);
    if (draft === undefined) {
      draft = new MessageDraft(initial);
      this.#messages.set(key, draft);
    }
    return draft;
  }
  text(key: string, initial = ""): TextDraft {
    if (this.#disposed) throw new Error("Draft store is disposed");
    let draft = this.#texts.get(key);
    if (draft === undefined) {
      draft = new TextDraft(initial);
      this.#texts.set(key, draft);
    }
    return draft;
  }
  move(from: string, to: string): "moved" | "missing" | "conflict" {
    const draft = this.#messages.get(from);
    if (draft === undefined) return "missing";
    if (from === to) return "moved";
    if (this.#messages.has(to)) return "conflict";
    this.#messages.set(to, draft);
    this.#messages.delete(from);
    return "moved";
  }
  forgetText(key: string, expected: TextDraft): void {
    if (this.#texts.get(key) !== expected) return;
    this.#texts.delete(key);
    expected.dispose();
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.comments.dispose();
    for (const draft of this.#messages.values()) draft.dispose();
    for (const draft of this.#texts.values()) draft.dispose();
    this.#messages.clear();
    this.#texts.clear();
  }
}
const Context = createContext<Drafts | null>(null);

/** Above connection and layout boundaries; drafts never enter localStorage or replicated server state. */
export function DraftsProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new Drafts());
  useDispose(drafts);
  return <Context.Provider value={drafts}>{children}</Context.Provider>;
}
export function useDrafts(): Drafts | null {
  return useContext(Context);
}

export function useMessageDraft(key?: string, initial = ""): MessageDraft {
  const drafts = useDrafts();
  const draft = useMemo(
    () => (key !== undefined && drafts !== null ? drafts.message(key, initial) : new MessageDraft(initial)),
    [drafts, key, initial],
  );
  useDispose(draft, key === undefined || drafts === null);
  return draft;
}
export function useTextDraft(key?: string, initial = ""): TextDraft {
  const drafts = useDrafts();
  const draft = useMemo(
    () => (key !== undefined && drafts !== null ? drafts.text(key, initial) : new TextDraft(initial)),
    [drafts, key, initial],
  );
  useDispose(draft, key === undefined || drafts === null);
  return draft;
}

const DUMMY_DISPOSABLE = { dispose() {} };
const FALLBACK_DRAFTS = new CommentDrafts();

export function useCommentDraftStore(): CommentDrafts {
  const drafts = useDrafts();
  const [local] = useState(() => (drafts === null ? new CommentDrafts() : null));
  useDispose(local ?? DUMMY_DISPOSABLE, local !== null);
  return drafts?.comments ?? local ?? FALLBACK_DRAFTS;
}

/** Defer disposal one microtask so StrictMode's cleanup/setup replay does not erase live input. */
function useDispose(resource: { dispose(): void }, enabled = true): void {
  const lifetime = useRef<{ resource: typeof resource } | null>(null);
  useEffect(() => {
    const lease = { resource };
    lifetime.current = lease;
    if (!enabled) return;
    return () =>
      queueMicrotask(() => {
        if (lifetime.current === lease || lifetime.current?.resource !== resource) resource.dispose();
      });
  }, [resource, enabled]);
}
