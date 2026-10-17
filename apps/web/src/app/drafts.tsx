import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { InputDraft } from "./input-draft.ts";

export class Drafts {
  readonly #drafts = new Map<string, InputDraft>();

  get(key: string, initial = ""): InputDraft {
    let draft = this.#drafts.get(key);
    if (draft === undefined) {
      draft = new InputDraft(initial);
      this.#drafts.set(key, draft);
    }
    return draft;
  }

  move(from: string, to: string): void {
    const draft = this.#drafts.get(from);
    if (draft === undefined) return;
    this.#drafts.get(to)?.dispose();
    this.#drafts.set(to, draft);
    this.#drafts.delete(from);
  }

  forget(key: string): void {
    this.#drafts.get(key)?.dispose();
    this.#drafts.delete(key);
  }

  dispose(): void {
    for (const draft of this.#drafts.values()) draft.dispose();
    this.#drafts.clear();
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

/** Without a provider/key this is an ordinary component-owned draft (also useful in isolated controls). */
export function useInputDraft(key?: string, initial = ""): InputDraft {
  const drafts = useDrafts();
  const draft = useMemo(
    () => (key !== undefined && drafts !== null ? drafts.get(key, initial) : new InputDraft(initial)),
    [drafts, key, initial],
  );
  useDispose(draft, key === undefined || drafts === null);
  return draft;
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
