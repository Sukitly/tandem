import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";
// Types only: the pi-durable runtime must not reach clients.
import type { ConversationView } from "@earendil-works/pi-durable";
import type { ModelRef } from "./models.ts";

export type { ConversationView };

/** A conversation as listed in the sidebar. */
export interface ConversationSummary {
  id: number;
  /** The project it belongs to. */
  workspaceId: number;
  /** Absolute path of the directory the agent works in: the project's. */
  cwd: string;
  /** Milliseconds since the Unix epoch. */
  createdAt: number;
  /** When the last message was sent, or else when it was created. */
  updatedAt: number;
  /** From the first message; absent until one is sent. */
  title?: string;
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
  /** Create a conversation in a project. Returns its ID. */
  create(input: { workspaceId: number }, context: Context): Promise<number>;
  /** Provide the conversation as a `Conversation` instance on this connection. Opening it again does nothing. */
  open(id: number, context: Context): Promise<void>;
  /** Withdraw the conversation's `Conversation` instance from this connection. */
  close(id: number, context: Context): Promise<void>;
}

export const Conversations = defineService<Conversations>("tandem.conversations");

export interface SubmitInput {
  text: string;
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
 * One open conversation. A keyed service: observe it to receive the instances this connection opened, and tell them
 * apart by `view.conversation.id`.
 */
export interface Conversation {
  readonly view: ReplicatedState<ConversationView>;
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
}

export const Conversation = defineService<Conversation>("tandem.conversation");
