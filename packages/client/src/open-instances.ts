import type { Context, Service } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { TandemConnection } from "./connect.ts";

export interface OpenInstancesOptions<TKey, TInstance> {
  /** The keyed service whose instances are kept open. */
  service: Service<TInstance>;
  /** Ask the server to start the instance of a key. */
  open(key: TKey, context: Context): Promise<void>;
  /** Let the server end it. */
  close(key: TKey, context: Context): Promise<void>;
  /** The key an instance belongs to, once its state has arrived; `undefined` if the instance ends first. */
  keyOf(instance: TInstance, context: Context): Promise<TKey | undefined>;
}

/**
 * Instances of a keyed service, opened on one connection. Each one is opened while anything holds it, and opened again
 * after a reconnect: instances belong to a connection, so they end when it drops.
 */
export class OpenInstances<TKey, TInstance> {
  readonly #connection: TandemConnection;
  readonly #options: OpenInstancesOptions<TKey, TInstance>;
  readonly #onError: (error: Error) => void;
  readonly #instances = new Map<TKey, TInstance>();
  readonly #failures = new Map<TKey, Error>();
  readonly #attempts = new Map<TKey, symbol>();
  #disposed = false;
  readonly #holds = new Map<TKey, number>();
  readonly #listeners = new Set<() => void>();
  readonly #stop: (() => void)[] = [];

  constructor(
    connection: TandemConnection,
    options: OpenInstancesOptions<TKey, TInstance>,
    onError?: (error: Error) => void,
  ) {
    this.#connection = connection;
    this.#options = options;
    this.#onError = onError ?? (() => {});
    this.#stop.push(
      connection.services.observe(options.service, (instance, context) => this.#track(instance, context)),
    );
    let connected = connection.status.value?.status === "connected";
    this.#stop.push(
      connection.status.subscribe(async (status) => {
        const reconnected = !connected && status.status === "connected";
        connected = status.status === "connected";
        if (reconnected) for (const key of this.#holds.keys()) this.#open(key);
      }),
    );
  }

  /** The instance of an open key, once it has arrived. */
  get(key: TKey): TInstance | undefined {
    return this.#instances.get(key);
  }

  /** Why the instance of a key has not arrived, if opening it failed. */
  failure(key: TKey): Error | undefined {
    return this.#failures.get(key);
  }

  /** Retry a failed, still-held instance. Idempotent while an attempt is in flight. */
  retry(key: TKey): void {
    if (!this.#disposed && this.#holds.has(key) && this.#failures.has(key) && !this.#instances.has(key))
      this.#open(key);
  }

  /** Keep an instance open until the returned function is called. */
  hold(key: TKey): () => void {
    const holds = this.#holds.get(key) ?? 0;
    this.#holds.set(key, holds + 1);
    if (holds === 0) this.#open(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.#holds.get(key) ?? 1) - 1;
      if (remaining > 0) {
        this.#holds.set(key, remaining);
        return;
      }
      this.#holds.delete(key);
      this.#attempts.delete(key);
      if (this.#failures.delete(key)) this.#notify();
      this.#options.close(key, BACKGROUND_CONTEXT).catch(() => {
        // Disconnected: the instance is gone already.
      });
    };
  }

  /** Called when an instance or its opening failure changes. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#disposed = true;
    this.#holds.clear();
    this.#attempts.clear();
    for (const stop of this.#stop.splice(0)) stop();
    this.#instances.clear();
    this.#failures.clear();
    this.#listeners.clear();
  }

  #open(key: TKey): void {
    if (this.#disposed) return;
    const attempt = Symbol();
    this.#attempts.set(key, attempt);
    if (this.#failures.delete(key)) this.#notify();
    this.#options.open(key, BACKGROUND_CONTEXT).catch((error: unknown) => {
      if (this.#disposed || this.#attempts.get(key) !== attempt || this.#instances.has(key)) return;
      // While disconnected, the next connection opens it again.
      if (this.#connection.status.value?.status !== "connected") return;
      const failure = error instanceof Error ? error : new Error(String(error));
      this.#failures.set(key, failure);
      this.#notify();
      this.#onError(failure);
    });
  }

  async #track(instance: TInstance, context: Context): Promise<void> {
    const key = await this.#options.keyOf(instance, context);
    if (key === undefined || this.#disposed || context.abortSignal?.aborted) return;
    this.#failures.delete(key);
    this.#instances.set(key, instance);
    // The instance arriving is what a component waits for; without this it is in the map but never rendered.
    this.#notify();
    const remove = (): void => {
      if (this.#instances.get(key) !== instance) return;
      this.#instances.delete(key);
      this.#notify();
    };
    if (context.abortSignal?.aborted) remove();
    else context.abortSignal?.addEventListener("abort", remove, { once: true });
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** The first hydrated value of a replicated state; `undefined` if it ends first. */
export function firstValue<T>(
  state: { readonly value: T | undefined; subscribe(listener: () => void): () => void },
  context: Context,
) {
  if (state.value !== undefined) return Promise.resolve(state.value);
  return new Promise<T | undefined>((resolve) => {
    const stop = state.subscribe(async () => {
      stop();
      resolve(state.value);
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
