import { type Context, copyJson, type MutableReplicatedState, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import {
  COMMENT_CONTEXT_LINES,
  type CommentAnchor,
  type CommentMessage,
  type CommentsState,
  type CommentThread,
  MAX_COMMENT_LENGTH,
  MAX_COMMENT_LINE_LENGTH,
  MAX_COMMENT_THREADS,
  MAX_THREAD_MESSAGES,
} from "@tandem/contracts";
import { invalidInput } from "./errors.ts";
import type { WorkspaceCatalog } from "./workspaces.ts";

type StoredComments = { nextThreadId: number; nextMessageId: number; threads: CommentThread[] };

const CommentsDoc = defineDoc<StoredComments>({
  kind: "tandem.comments",
  version: 1,
  scope: "session",
  initial: () => ({ nextThreadId: 1, nextMessageId: 1, threads: [] }),
});

const MAX_PATH_LENGTH = 4096;

export interface CommentBoardOptions {
  now?: () => number;
  /** Where a failure no caller is told of goes: comments of a message that went out, which could not be marked sent. */
  onError?: (error: Error) => void;
}

/** Waiting messages taken for a message that is being sent; `sent()` or `release()` settles them. */
export interface TakenComments {
  /** What the agent reads ahead of the user's text; `""` when nothing was taken. */
  readonly text: string;
  /** The first thread taken, for a conversation that has no other title. */
  readonly first?: CommentThread;
  /** The message was taken: its comments are sent with it. */
  sent(sent: { conversationId: number; requestId: string }, context: Context): Promise<void>;
  /** The message was refused: its comments wait again. */
  release(): void;
}

/**
 * The comment threads of every project, stored in the Harness's database. It is the only writer of the document, so it
 * publishes the threads after each of its own commits. Threads of removed projects are kept, but not listed.
 */
export class CommentBoard {
  readonly #harness: Harness;
  readonly #workspaces: WorkspaceCatalog;
  readonly #now: () => number;
  readonly #onError: (error: Error) => void;
  readonly #state: MutableReplicatedState<CommentsState>;
  readonly #stop: () => void;
  /** Messages a send has taken and not yet settled: another send must not take them too. */
  readonly #taken = new Set<number>();
  #stored: readonly CommentThread[];

  private constructor(
    harness: Harness,
    workspaces: WorkspaceCatalog,
    options: CommentBoardOptions,
    stored: CommentThread[],
  ) {
    this.#harness = harness;
    this.#workspaces = workspaces;
    this.#now = options.now ?? Date.now;
    this.#onError = options.onError ?? (() => {});
    this.#stored = stored;
    this.#state = replicatedState<CommentsState>({ threads: this.#listed() });
    this.#stop = workspaces.subscribe(() => this.#publish());
  }

  static async load(
    harness: Harness,
    workspaces: WorkspaceCatalog,
    context: Context,
    options: CommentBoardOptions = {},
  ): Promise<CommentBoard> {
    const doc = await harness.snapshot(CommentsDoc, context);
    return new CommentBoard(harness, workspaces, options, copyJson(doc?.threads ?? []) as CommentThread[]);
  }

  get state(): MutableReplicatedState<CommentsState> {
    return this.#state;
  }

  async start(input: unknown, context: Context): Promise<number> {
    const { workspaceId, anchor, text } = (input ?? {}) as { workspaceId?: unknown; anchor?: unknown; text?: unknown };
    if (typeof workspaceId !== "number" || !this.#workspaces.isListed(workspaceId))
      throw invalidInput(`Project ${String(workspaceId)} does not exist`);
    const parsed = parseAnchor(anchor);
    const note = parseText(text);
    const createdAt = this.#now();
    return this.#update(context, (doc) => {
      if (doc.threads.filter((thread) => thread.workspaceId === workspaceId).length >= MAX_COMMENT_THREADS)
        throw invalidInput(`A project holds at most ${MAX_COMMENT_THREADS} comment threads`);
      const id = doc.nextThreadId++;
      doc.threads.push({
        id,
        workspaceId,
        anchor: parsed,
        messages: [{ id: doc.nextMessageId++, author: "user", text: note, createdAt }],
      });
      return id;
    });
  }

  async reply(input: unknown, context: Context): Promise<number> {
    const { threadId, text } = (input ?? {}) as { threadId?: unknown; text?: unknown };
    const note = parseText(text);
    const createdAt = this.#now();
    return this.#update(context, (doc) => {
      const thread = findThread(doc, threadId);
      if (thread.messages.length >= MAX_THREAD_MESSAGES)
        throw invalidInput(`A thread holds at most ${MAX_THREAD_MESSAGES} messages`);
      const id = doc.nextMessageId++;
      thread.messages.push({ id, author: "user", text: note, createdAt });
      return id;
    });
  }

  async edit(input: unknown, context: Context): Promise<void> {
    const { threadId, messageId, text } = (input ?? {}) as { threadId?: unknown; messageId?: unknown; text?: unknown };
    const note = parseText(text);
    await this.#update(context, (doc) => {
      this.#waiting(findThread(doc, threadId), messageId).text = note;
    });
  }

  async withdraw(input: unknown, context: Context): Promise<void> {
    const { threadId, messageId } = (input ?? {}) as { threadId?: unknown; messageId?: unknown };
    await this.#update(context, (doc) => {
      const thread = findThread(doc, threadId);
      const message = this.#waiting(thread, messageId);
      thread.messages = thread.messages.filter((candidate) => candidate !== message);
      if (thread.messages.length === 0) doc.threads = doc.threads.filter((candidate) => candidate !== thread);
    });
  }

  async remove(threadId: unknown, context: Context): Promise<void> {
    await this.#update(context, (doc) => {
      const thread = findThread(doc, threadId);
      if (thread.messages.some((message) => this.#taken.has(message.id)))
        throw invalidInput("The thread is being sent; try again in a moment");
      doc.threads = doc.threads.filter((candidate) => candidate !== thread);
    });
  }

  /**
   * Take the waiting messages a message carries, for its text. Messages that are not waiting any more—sent from
   * another page, or taken back—are left out, and so are those of other projects.
   */
  take(workspaceId: number, ids: unknown): TakenComments {
    if (ids !== undefined && !(Array.isArray(ids) && ids.every((id) => Number.isSafeInteger(id))))
      throw invalidInput("comments must be a list of message IDs");
    const wanted = new Set<number>((ids as number[] | undefined) ?? []);
    const taken: { thread: CommentThread; messages: CommentMessage[] }[] = [];
    for (const thread of this.#stored) {
      if (thread.workspaceId !== workspaceId) continue;
      const messages = thread.messages.filter(
        (message) =>
          wanted.has(message.id) &&
          message.author === "user" &&
          message.sent === undefined &&
          !this.#taken.has(message.id),
      );
      if (messages.length > 0) taken.push({ thread, messages });
    }
    const takenIds = taken.flatMap(({ messages }) => messages.map((message) => message.id));
    for (const id of takenIds) this.#taken.add(id);
    let settled = false;
    const release = (): void => {
      if (settled) return;
      settled = true;
      for (const id of takenIds) this.#taken.delete(id);
    };
    return {
      text: taken.map(({ thread, messages }) => threadText(thread, messages)).join("\n\n"),
      ...(taken[0] === undefined ? {} : { first: taken[0].thread }),
      sent: async (sent, context) => {
        if (settled) return;
        try {
          await this.#update(context, (doc) => {
            for (const thread of doc.threads)
              for (const message of thread.messages) if (takenIds.includes(message.id)) message.sent = { ...sent };
          });
        } catch (error) {
          this.#onError(
            new Error(`Comments sent with request ${sent.requestId} could not be marked sent`, { cause: error }),
          );
          throw error;
        } finally {
          release();
        }
      },
      release,
    };
  }

  dispose(): void {
    this.#stop();
  }

  /** A user's message that has not been sent, nor taken by a send that is under way. */
  #waiting(thread: CommentThread, messageId: unknown): CommentMessage {
    const message = thread.messages.find((candidate) => candidate.id === messageId);
    if (message === undefined) throw invalidInput(`Comment ${String(messageId)} does not exist`);
    if (message.author !== "user" || message.sent !== undefined || this.#taken.has(message.id))
      throw invalidInput("The comment has been sent already");
    return message;
  }

  async #update<R>(context: Context, change: (doc: StoredComments) => R): Promise<R> {
    const { result, stored } = await this.#harness.commit(async (tx) => {
      const doc = await tx.doc(CommentsDoc);
      const result = change(doc);
      return { result, stored: copyJson(doc.threads) as CommentThread[] };
    }, context);
    this.#stored = stored;
    this.#publish();
    return result;
  }

  #listed(): CommentThread[] {
    return this.#stored.filter((thread) => this.#workspaces.isListed(thread.workspaceId));
  }

  #publish(): void {
    const threads = this.#listed();
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.threads = copyJson(threads) as CommentThread[];
    });
  }
}

/**
 * What the agent reads of a thread: its number, so that a reply can name it, the place and the line it is about, what
 * was said before, and the new messages. The place is a Markdown link, so the transcript shows it as one.
 */
export function threadText(thread: CommentThread, messages: readonly CommentMessage[]): string {
  const { path, line, quote } = thread.anchor;
  const last = Math.max(...messages.map((message) => message.id));
  // Everything said up to the newest message, so that a conversation that did not see the thread can follow it.
  const said = thread.messages.filter((message) => message.id <= last);
  const blocks = [`Comment #${thread.id} on [${path}:${line}](${path}#L${line})`];
  if (quote.trim() !== "") blocks.push(`> ${quote.trim()}`);
  if (said.length === 1) blocks.push((said[0] as CommentMessage).text);
  else for (const message of said) blocks.push(`**${message.author === "user" ? "User" : "Agent"}:** ${message.text}`);
  return blocks.join("\n\n");
}

function findThread(doc: StoredComments, threadId: unknown): CommentThread {
  const thread = doc.threads.find((candidate) => candidate.id === threadId);
  if (thread === undefined) throw invalidInput(`Comment thread ${String(threadId)} does not exist`);
  return thread;
}

function parseText(text: unknown): string {
  if (typeof text !== "string" || text.trim() === "") throw invalidInput("Write the comment first");
  if (text.length > MAX_COMMENT_LENGTH) throw invalidInput(`A comment is at most ${MAX_COMMENT_LENGTH} characters`);
  return text.trim();
}

/** The anchor as it is stored: lines that are too long are cut, and at most so many are kept on each side. */
function parseAnchor(anchor: unknown): CommentAnchor {
  const { path, line, side, quote, before, after } = (anchor ?? {}) as Record<string, unknown>;
  if (typeof path !== "string" || path === "" || path.length > MAX_PATH_LENGTH || path.startsWith("/"))
    throw invalidInput("The comment's path must be relative to the project");
  if (!Number.isSafeInteger(line) || (line as number) < 1) throw invalidInput("The comment's line must be 1 or more");
  if (side !== undefined && side !== "additions" && side !== "deletions")
    throw invalidInput('The comment\'s side must be "additions" or "deletions"');
  if (typeof quote !== "string") throw invalidInput("The comment's quote must be a string");
  return {
    path,
    line: line as number,
    ...(side === undefined ? {} : { side }),
    quote: cut(quote),
    before: lines(before, "before").slice(-COMMENT_CONTEXT_LINES),
    after: lines(after, "after").slice(0, COMMENT_CONTEXT_LINES),
  };
}

function lines(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((line) => typeof line === "string"))
    throw invalidInput(`The comment's ${name} must be a list of lines`);
  return value.map(cut);
}

function cut(line: string): string {
  return line.length > MAX_COMMENT_LINE_LENGTH ? line.slice(0, MAX_COMMENT_LINE_LENGTH) : line;
}
