import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Conversation, Conversations } from "@tandem/contracts";
import type { TandemConnection } from "./connect.ts";

/**
 * The conversations a client shows, opened on its connection. Each one is opened while anything holds it, and opened
 * again after a reconnect: instances belong to a connection, so they end when it drops.
 */
export class OpenConversations {
  readonly #connection: TandemConnection;
  readonly #conversations: Conversations;
  readonly #onError: (error: Error) => void;
  readonly #instances = new Map<number, Conversation>();
  readonly #holds = new Map<number, number>();
  readonly #listeners = new Set<() => void>();
  readonly #stop: (() => void)[] = [];

  constructor(connection: TandemConnection, onError: (error: Error) => void = () => {}) {
    this.#connection = connection;
    this.#conversations = connection.services.use(Conversations);
    this.#onError = onError;
    this.#stop.push(connection.services.observe(Conversation, (instance, context) => this.#track(instance, context)));
    let connected = connection.status.value?.status === "connected";
    this.#stop.push(
      connection.status.subscribe(async (status) => {
        const reconnected = !connected && status.status === "connected";
        connected = status.status === "connected";
        if (reconnected) for (const id of this.#holds.keys()) this.#open(id);
      }),
    );
  }

  /** The instance of an open conversation, once it has arrived. */
  get(id: number): Conversation | undefined {
    return this.#instances.get(id);
  }

  /** Keep the conversation open until the returned function is called. */
  hold(id: number): () => void {
    const holds = this.#holds.get(id) ?? 0;
    this.#holds.set(id, holds + 1);
    if (holds === 0) this.#open(id);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.#holds.get(id) ?? 1) - 1;
      if (remaining > 0) {
        this.#holds.set(id, remaining);
        return;
      }
      this.#holds.delete(id);
      this.#conversations.close(id, BACKGROUND_CONTEXT).catch(() => {
        // Disconnected: the instance is gone already.
      });
    };
  }

  /** Called when an instance arrives or leaves. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    for (const stop of this.#stop.splice(0)) stop();
    this.#instances.clear();
    this.#listeners.clear();
  }

  #open(id: number): void {
    this.#conversations.open(id, BACKGROUND_CONTEXT).catch((error: unknown) => {
      // While disconnected, the next connection opens it again.
      if (this.#connection.status.value?.status !== "connected") return;
      this.#onError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  async #track(instance: Conversation, context: Context): Promise<void> {
    const view = instance.view.value ?? (await firstValue(instance, context));
    if (view === undefined) return;
    const id = view.conversation.id;
    this.#instances.set(id, instance);
    this.#notify();
    const remove = (): void => {
      if (this.#instances.get(id) !== instance) return;
      this.#instances.delete(id);
      this.#notify();
    };
    if (context.abortSignal?.aborted) remove();
    else context.abortSignal?.addEventListener("abort", remove, { once: true });
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** The first hydrated view of an instance; `undefined` if the instance ends first. */
function firstValue(instance: Conversation, context: Context) {
  return new Promise<Conversation["view"]["value"]>((resolve) => {
    const stop = instance.view.subscribe(async (value) => {
      stop();
      resolve(value);
    });
    context.abortSignal?.addEventListener(
      "abort",
      () => {
        stop();
        resolve(undefined);
      },
      { once: true },
    );
  });
}
