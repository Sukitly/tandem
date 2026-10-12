import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type CommentAnchor, type Comments, type CommentThread, waitingMessages } from "@tandem/contracts";
import { useMemo } from "react";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";

/** Nothing written. The same value every time, so that a project without threads is no change. */
const NONE: CommentThread[] = [];

/**
 * The comment threads of one project, as the server keeps them, and what can be done with them. Every page shows the
 * same threads; what is written waits on the server until it is sent with a message.
 */
export class ProjectComments {
  readonly #comments: Comments;
  readonly workspaceId: number;

  constructor(comments: Comments, workspaceId: number) {
    this.#comments = comments;
    this.workspaceId = workspaceId;
  }

  get state(): Comments["state"] {
    return this.#comments.state;
  }

  start(anchor: CommentAnchor, text: string): Promise<number> {
    return this.#comments.start({ workspaceId: this.workspaceId, anchor, text }, BACKGROUND_CONTEXT);
  }

  reply(threadId: number, text: string): Promise<number> {
    return this.#comments.reply({ threadId, text }, BACKGROUND_CONTEXT);
  }

  edit(threadId: number, messageId: number, text: string): Promise<void> {
    return this.#comments.edit({ threadId, messageId, text }, BACKGROUND_CONTEXT);
  }

  withdraw(threadId: number, messageId: number): Promise<void> {
    return this.#comments.withdraw({ threadId, messageId }, BACKGROUND_CONTEXT);
  }

  remove(threadId: number): Promise<void> {
    return this.#comments.remove(threadId, BACKGROUND_CONTEXT);
  }
}

/** The threads of a project, oldest first. */
export function useCommentThreads(comments: ProjectComments | undefined): CommentThread[] {
  const all = useReplicatedState(comments?.state)?.threads;
  const workspaceId = comments?.workspaceId;
  return useMemo(
    () => (all === undefined ? NONE : all.filter((thread) => thread.workspaceId === workspaceId)),
    [all, workspaceId],
  );
}

/** A message waiting to be sent, with the thread it is in. */
export interface WaitingComment {
  thread: CommentThread;
  messageId: number;
  text: string;
}

/** What the next message of a project carries: every message of its threads that waits to be sent. */
export function waitingComments(threads: readonly CommentThread[]): WaitingComment[] {
  return threads.flatMap((thread) =>
    waitingMessages(thread).map((message) => ({ thread, messageId: message.id, text: message.text })),
  );
}
