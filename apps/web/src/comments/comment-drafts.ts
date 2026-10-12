import { useCallback, useSyncExternalStore } from "react";
import type { LineComment } from "./line-comment.ts";

const COMMENTS_KEY = "tandem.comments";

/** Nothing waiting. The same value every time, so that a store that is not there yet is no change. */
const NONE: LineComment[] = [];

let nextId = 0;

/**
 * The comments written in the panels of one project, waiting to be sent with the next message. They are kept in the
 * browser, so a reload does not throw a review away. Comments belong to the project rather than to a conversation:
 * they are notes about the code, and any conversation in that project can carry them.
 */
export class CommentDrafts {
  readonly #key: string;
  readonly #storage: Storage | undefined;
  readonly #listeners = new Set<() => void>();
  #comments: LineComment[];
  #revision = 0;

  constructor(workspaceId: number, storage: Storage | undefined = browserStorage()) {
    this.#key = `${COMMENTS_KEY}.${workspaceId}`;
    this.#storage = storage;
    this.#comments = parseComments(storage?.getItem(this.#key) ?? null);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Every comment of the project, oldest first. It is the same array until a comment changes. */
  get all(): LineComment[] {
    return this.#comments;
  }

  /** Counts the changes. A renderer that cannot see a comment change by itself watches this. */
  get revision(): number {
    return this.#revision;
  }

  /** Write a comment; it is unknown, so it gets an identifier. */
  add(comment: Omit<LineComment, "id">): LineComment {
    nextId += 1;
    const written = { ...comment, id: `${Date.now().toString(36)}-${nextId.toString(36)}` };
    this.#changed([...this.#comments, written]);
    return written;
  }

  /** Change a comment's note. What it is about—the file and the line—stays. */
  update(id: string, text: string): void {
    this.#changed(this.#comments.map((comment) => (comment.id === id ? { ...comment, text } : comment)));
  }

  remove(id: string): void {
    this.#changed(this.#comments.filter((comment) => comment.id !== id));
  }

  /** The comments were sent; nothing is waiting any more. */
  clear(): void {
    this.#changed([]);
  }

  #changed(comments: LineComment[]): void {
    this.#comments = comments;
    this.#revision += 1;
    try {
      this.#storage?.setItem(this.#key, JSON.stringify(comments));
    } catch {
      // A browser that is full or that refuses storage keeps the comments in memory.
    }
    for (const listener of this.#listeners) listener();
  }
}

/** The comments of a project, for a component that shows them. */
export function useCommentDrafts(drafts: CommentDrafts | undefined): LineComment[] {
  const subscribe = useCallback((onChange: () => void) => drafts?.subscribe(onChange) ?? (() => {}), [drafts]);
  const read = useCallback(() => drafts?.all ?? NONE, [drafts]);
  return useSyncExternalStore(subscribe, read);
}

/**
 * The comments a stored value holds, leaving out anything that is not one: another page version may have written it,
 * or it may be edited.
 */
export function parseComments(stored: string | null): LineComment[] {
  if (stored === null) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isComment) : [];
  } catch {
    return [];
  }
}

function isComment(value: unknown): value is LineComment {
  if (typeof value !== "object" || value === null) return false;
  const { id, path, line, side, quote, text } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    typeof path === "string" &&
    typeof line === "number" &&
    Number.isSafeInteger(line) &&
    (side === undefined || side === "additions" || side === "deletions") &&
    typeof quote === "string" &&
    typeof text === "string"
  );
}

function browserStorage(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}
