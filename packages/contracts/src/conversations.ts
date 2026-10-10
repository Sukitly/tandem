import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";
// Types only: the pi-durable runtime must not reach clients.
import type { ConversationView } from "@earendil-works/pi-durable";

export type { ConversationView };

/** A conversation as listed in the sidebar. */
export interface ConversationSummary {
  id: number;
  /** Absolute path of the directory the agent works in. */
  cwd: string;
  /** Milliseconds since the Unix epoch. */
  createdAt: number;
  /** From the first message; absent until one is sent. */
  title?: string;
}

export interface ConversationsState {
  /** Newest first. */
  conversations: ConversationSummary[];
}

/**
 * The conversation list, shared by every client. Conversations are opened per connection: `open()` makes the server
 * provide a `Conversation` instance on the calling connection only, so clients receive the state of the conversations
 * they show and nothing else.
 */
export interface Conversations {
  readonly state: ReplicatedState<ConversationsState>;
  /** Create a conversation working in `cwd`, an absolute path to a directory. Returns its ID. */
  create(input: { cwd: string }, context: Context): Promise<number>;
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

/**
 * One open conversation. A keyed service: observe it to receive the instances this connection opened, and tell them
 * apart by `view.conversation.id`.
 */
export interface Conversation {
  readonly view: ReplicatedState<ConversationView>;
  /** Resolves once the message is durably admitted, not when the agent answers. */
  submit(input: SubmitInput, context: Context): Promise<void>;
  /** Stop the agent. Resolves once the conversation is idle. */
  abort(context: Context): Promise<void>;
}

export const Conversation = defineService<Conversation>("tandem.conversation");
