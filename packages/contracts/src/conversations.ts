import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";
import type { ConversationView, ImageInput } from "./images.ts";
import type { ModelRef } from "./models.ts";

export type { ConversationView };

/** Longest conversation title, in characters. */
export const MAX_CONVERSATION_TITLE_LENGTH = 80;

/** A conversation as listed in the sidebar. */
export interface ConversationSummary {
  id: number;
  /** The project it belongs to. */
  workspaceId: number;
  /** Absolute path of the directory the agent works in: the project's. */
  cwd: string;
  /** Milliseconds since the Unix epoch. */
  createdAt: number;
  /** When the last message was sent. */
  updatedAt: number;
  /** From the first message. */
  title: string;
  /** The agent is working. */
  running: boolean;
}

export interface ConversationsState {
  /** The conversations of the listed projects, most recently active first. */
  conversations: ConversationSummary[];
}

/**
 * The conversation list, shared by every client. Conversations are opened per connection: `open()` makes the server
 * provide a `Conversation` instance on the calling connection only, so clients receive the state of the conversations
 * they show and nothing else.
 */
export interface Conversations {
  readonly state: ReplicatedState<ConversationsState>;
  /**
   * Start a conversation in a project with its first message, and the model and thinking level chosen before it was
   * sent (the default model otherwise). A conversation exists only from its first message. Returns its ID.
   */
  start(input: StartInput, context: Context): Promise<number>;
  /** Provide the conversation as a `Conversation` instance on this connection. Opening it again does nothing. */
  open(id: number, context: Context): Promise<void>;
  /** Withdraw the conversation's `Conversation` instance from this connection. */
  close(id: number, context: Context): Promise<void>;
  /** Rename a conversation. */
  rename(id: number, title: string, context: Context): Promise<void>;
  /** Take a conversation off the list and mark it removed. If the agent is working, it is stopped. */
  remove(id: number, context: Context): Promise<void>;
}

export const Conversations = defineService<Conversations>("tandem.conversations");

export interface StartInput {
  workspaceId: number;
  /** May be empty when the message carries comments or images. */
  text: string;
  /** Waiting comment messages of the project that go with it, by ID; see `SubmitInput.comments`. */
  comments?: number[];
  /** See `SubmitInput.images`. */
  images?: ImageInput[];
  model?: ModelRef;
  thinkingLevel?: string;
}

export interface SubmitInput {
  /** May be empty when the message carries comments or images. */
  text: string;
  /**
   * Waiting comment messages of the conversation's project that go with it, by ID. The server writes them into the
   * message ahead of the text, each with the place it is about, and marks them sent once the message is taken.
   */
  comments?: number[];
  /**
   * Images after the text, as the files are: the server fits each to the model, so a page sends them unchanged. Refused
   * when the model takes no images, or more than it takes in a message, or above `MAX_MESSAGE_IMAGE_BYTES` together.
   */
  images?: ImageInput[];
  /** What happens when the agent is working: interrupt it at the next step, or wait until it finishes. */
  whenBusy: "steer" | "followUp";
}

/** A message that got no answer, such as one sent without a model. Answers that fail are part of the view. */
export interface ConversationNotice {
  id: number;
  message: string;
}

export interface ConversationNotices {
  /** Cleared when the next message is sent. */
  notices: ConversationNotice[];
}

/**
 * How the last agent run of a conversation performed, as pi's `tps` extension reports after each run: the throughput
 * it reached, the tokens it spent, and how long it took. The server times the run across its busy edges and reads the
 * tokens from the answers; the page renders what it is given.
 */
export interface RunTps {
  /** Output tokens a second, over the run's whole duration, tool execution included. */
  tokensPerSecond: number;
  /** Prompt tokens the provider did not have cached. */
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens the provider read from its cache. */
  cacheReadTokens: number;
  /** Prompt tokens the provider wrote to its cache. */
  cacheWriteTokens: number;
  totalTokens: number;
  /** How long the run took, in seconds. */
  seconds: number;
}

/** The last run's throughput of one conversation; `last` is absent before its first answer. */
export interface ConversationTps {
  last?: RunTps;
}

/** Most entries `Conversation.history` returns in one page, and what it returns when no `limit` is given. */
export const HISTORY_PAGE_SIZE = 50;
export const MAX_HISTORY_PAGE_SIZE = 200;

/** What `Conversation.history` is asked for: the entries before `before`, at most `limit` of them. */
export interface HistoryInput {
  /** An entry ID: the entries returned are those with a smaller one. */
  before: number;
  /** At most this many, `HISTORY_PAGE_SIZE` by default and `MAX_HISTORY_PAGE_SIZE` at most. */
  limit?: number;
}

/** One page of a conversation's older entries. */
export interface ConversationHistory {
  /** Oldest first, the last of them the newest entry before `before`; images are references, as in the view. */
  entries: ConversationView["entries"];
  /** Whether there are entries before the first of these. */
  more: boolean;
}

/**
 * One open conversation. A keyed service: observe it to receive the instances this connection opened, and tell them
 * apart by `view.conversation.id`.
 */
export interface Conversation {
  readonly view: ReplicatedState<ConversationView>;
  /** The last run's throughput, recomputed as the transcript changes. */
  readonly tps: ReplicatedState<ConversationTps>;
  /** Shared by every client showing the conversation; kept in memory only. */
  readonly notices: ReplicatedState<ConversationNotices>;
  /** Resolves once the message is durably admitted, not when the agent answers. */
  submit(input: SubmitInput, context: Context): Promise<void>;
  /** Stop the agent. Resolves once the conversation is idle. */
  abort(context: Context): Promise<void>;
  /**
   * Change the model or the thinking level for the next answers. A thinking level the model does not support is
   * lowered to the nearest one it does.
   */
  configure(input: { model?: ModelRef; thinkingLevel?: string }, context: Context): Promise<void>;
  /**
   * The entries before `input.before`, which `view` leaves out once a compaction has replaced them with a summary: it
   * holds what the model sees, and these are still stored. Taken a page at a time, the next from the first entry of the
   * last page.
   */
  history(input: HistoryInput, context: Context): Promise<ConversationHistory>;
}

export const Conversation = defineService<Conversation>("tandem.conversation");
