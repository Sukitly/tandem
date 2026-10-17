import { Conversation, Conversations } from "@tandem/contracts";
import type { TandemConnection } from "./connect.ts";
import { firstValue, OpenInstances } from "./open-instances.ts";

/**
 * The conversations a client shows, opened on its connection. Each one is opened while anything holds it, and opened
 * again after a reconnect: instances belong to a connection, so they end when it drops.
 */
export class OpenConversations {
  readonly #instances: OpenInstances<number, Conversation>;

  constructor(connection: TandemConnection, onError: (error: Error) => void = () => {}) {
    const conversations = connection.services.use(Conversations);
    this.#instances = new OpenInstances(
      connection,
      {
        service: Conversation,
        open: (id, context) => conversations.open(id, context),
        close: (id, context) => conversations.close(id, context),
        keyOf: async (instance, context) =>
          (instance.view.value ?? (await firstValue(instance.view, context)))?.conversation.id,
      },
      onError,
    );
  }

  /** The instance of an open conversation, once it has arrived. */
  get(id: number): Conversation | undefined {
    return this.#instances.get(id);
  }

  failure(id: number): Error | undefined {
    return this.#instances.failure(id);
  }

  retry(id: number): void {
    this.#instances.retry(id);
  }

  /** Keep the conversation open until the returned function is called. */
  hold(id: number): () => void {
    return this.#instances.hold(id);
  }

  /** Called when an instance arrives or leaves. */
  subscribe(listener: () => void): () => void {
    return this.#instances.subscribe(listener);
  }

  dispose(): void {
    this.#instances.dispose();
  }
}
