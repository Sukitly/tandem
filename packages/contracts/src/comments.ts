import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";

/** Which side of a diff a line is on: the file as it is, or as the base commit had it. */
export type CommentSide = "additions" | "deletions";

/**
 * The line a thread is about, as it was when the thread was started. Line numbers move as the files change, so the
 * line's text and the lines around it are kept too: they find the line again, and show what it was once it is gone.
 */
export type CommentAnchor = {
  /** From the project's directory, separated by `/`. */
  path: string;
  /** 1-based. */
  line: number;
  /** Absent for a line of the file as it is, which is the additions side of a diff. */
  side?: CommentSide;
  /** The line's text. */
  quote: string;
  /** Up to `COMMENT_CONTEXT_LINES` lines before it, nearest last. */
  before: string[];
  /** Up to `COMMENT_CONTEXT_LINES` lines after it, nearest first. */
  after: string[];
};

export type CommentMessage = {
  id: number;
  author: "user" | "agent";
  text: string;
  /** Milliseconds since the Unix epoch. */
  createdAt: number;
  /**
   * A user's message, once it went to the agent: with which message of which conversation. Until then it is waiting,
   * and goes with the next message the user sends in the project.
   */
  sent?: { conversationId: number; requestId: string };
  /** An agent's message: the conversation it was written in. */
  conversationId?: number;
};

/** A discussion on a line of a project's file. It belongs to the project, so any of its conversations can take it up. */
export type CommentThread = {
  id: number;
  workspaceId: number;
  anchor: CommentAnchor;
  /** Oldest first; the first one started the thread. Never empty. */
  messages: CommentMessage[];
};

export type CommentsState = {
  /** The threads of the listed projects, oldest first. */
  threads: CommentThread[];
};

/** Lines kept on each side of a thread's line. */
export const COMMENT_CONTEXT_LINES = 3;

/** Longest message, in characters. */
export const MAX_COMMENT_LENGTH = 10_000;

/** Longest kept line of code, in characters; longer ones are cut. */
export const MAX_COMMENT_LINE_LENGTH = 1_000;

/** Most threads one project holds. */
export const MAX_COMMENT_THREADS = 200;

/** Most messages one thread holds. */
export const MAX_THREAD_MESSAGES = 100;

/**
 * The comment threads of every project, shared by all clients and kept by the server. What a user writes waits there
 * until it is sent with a message: `Conversation.submit()` and `Conversations.start()` take the waiting messages by ID.
 */
export interface Comments {
  readonly state: ReplicatedState<CommentsState>;
  /** Start a thread on a line with the user's first message. Returns the thread's ID. */
  start(input: { workspaceId: number; anchor: CommentAnchor; text: string }, context: Context): Promise<number>;
  /** Add the user's message to a thread. Returns the message's ID. */
  reply(input: { threadId: number; text: string }, context: Context): Promise<number>;
  /** Change a user's message that has not been sent. */
  edit(input: { threadId: number; messageId: number; text: string }, context: Context): Promise<void>;
  /** Take back a user's message that has not been sent; a thread left with no messages goes with it. */
  withdraw(input: { threadId: number; messageId: number }, context: Context): Promise<void>;
  /** Delete a thread with all its messages. */
  remove(threadId: number, context: Context): Promise<void>;
}

export const Comments = defineService<Comments>("tandem.comments");

/** The messages of a thread that wait to be sent. */
export function waitingMessages(thread: CommentThread): CommentMessage[] {
  return thread.messages.filter((message) => message.author === "user" && message.sent === undefined);
}
