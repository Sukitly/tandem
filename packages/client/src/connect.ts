import {
  type Context,
  createRemoteServiceBinding,
  type RemoteServices,
  type ReplicatedState,
  replicatedState,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Client, createClientServiceTransport } from "@earendil-works/pi-client";
import { BOOTSTRAP_PATH, type BootstrapResponse, type ImageRef, imagePath, RPC_PATH } from "@tandem/contracts";
import {
  CONNECTION_TIMEOUT_MS,
  onConnectionWake,
  PROBE_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  withDeadline,
} from "./connection-lifecycle.ts";
import { TerminalConnection, type TerminalConnectionOptions, type TerminalScreen } from "./terminal-connection.ts";
import { createWebSocketTransportFactory } from "./websocket-transport.ts";

export type ConnectionStatus =
  | { status: "unauthorized" }
  | { status: "connecting" }
  | { status: "connected" }
  | { status: "disconnected"; reason: string; retryInMs: number | null };

export interface ReconnectOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export interface ConnectOptions {
  /** HTTP origin of the Tandem server, for example `http://127.0.0.1:4820`. */
  baseUrl: string | URL;
  /** Node clients only. Browsers authenticate with same-origin cookies. */
  token?: string;
  /** Services this connection binds. Only these can be used or observed. */
  services: readonly { readonly id: string }[];
  /** `false` disables reconnecting after the connection drops. */
  reconnect?: ReconnectOptions | false;
  /** Cancels initial connection work and closes the connection if it has already opened. */
  signal?: AbortSignal;
  onError?: (error: Error) => void;
}

export interface TandemConnection {
  readonly deviceId?: string;
  /** Bound services. Handles stay valid across reconnects; their state rehydrates after each one. */
  readonly services: RemoteServices;
  /** `connected` is reported once the services are bound and can be called. */
  readonly status: ReplicatedState<ConnectionStatus>;
  /** Connect to a terminal with this connection's server and authentication mode. */
  terminal(id: string, screen: TerminalScreen, options?: TerminalOptions): TerminalConnection;
  /** Fetch a transcript image using a device cookie or a Node client's bearer header. Rejects for anything but 200. */
  image(ref: ImageRef, signal?: AbortSignal): Promise<Blob>;
  /** Same-origin image path for a browser with a paired-device cookie. */
  imageUrl(ref: ImageRef): string;
  close(): Promise<void>;
}

export type TerminalOptions = Pick<TerminalConnectionOptions, "onLink" | "onError" | "socket">;

export class BootstrapError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Bootstrap request failed with status ${status}`);
    this.name = "BootstrapError";
    this.status = status;
  }
}

const DEFAULT_INITIAL_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 5_000;

/**
 * Connect to a Tandem server: fetch the bootstrap data, open the pi-protocol connection over WebSocket, and bind the
 * given services. The returned promise rejects when the first connection fails; later disconnects are retried.
 */
export async function connect(options: ConnectOptions): Promise<TandemConnection> {
  const baseUrl = new URL(options.baseUrl);
  const onError = options.onError ?? (() => {});
  const { serverId, deviceId } = await withDeadline(
    (signal) => bootstrap(baseUrl, options.token, signal),
    CONNECTION_TIMEOUT_MS,
    options.signal,
  );

  const rpcUrl = new URL(RPC_PATH, baseUrl);
  rpcUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";

  let transportSignal: AbortSignal | undefined;
  const client = new Client({
    serverId,
    transportFactory: (handlers) =>
      createWebSocketTransportFactory(rpcUrl, { token: options.token, signal: transportSignal })(handlers),
    onListenerError: onError,
  });
  const binding = createRemoteServiceBinding({
    services: options.services,
    transport: createClientServiceTransport(client, () => ({ serverId: client.serverId })),
    bound: false,
    onError,
  });
  const status = replicatedState<ConnectionStatus>({ status: "connecting" });

  const reconnect = options.reconnect === false ? undefined : (options.reconnect ?? {});
  const initialDelayMs = reconnect?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = reconnect?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  let delayMs = initialDelayMs;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let unauthorized = false;
  let active: AbortController | undefined;
  let probe: AbortController | undefined;
  let generation = 0;
  let stopWake = (): void => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  // Rebinding is serialized so that bound and unbound transitions apply in connection order.
  let transitions = Promise.resolve();
  const rebind = (bound: boolean, context: Context): void => {
    transitions = transitions
      .then(() => binding.rebind(bound, context))
      .catch((error: unknown) => onError(toError(error)));
  };

  const clearRetry = (): void => {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  };

  const scheduleReconnect = (reason: string): void => {
    if (closed || unauthorized || active !== undefined || retryTimer !== undefined) return;
    const wait = reconnect === undefined ? null : delayMs;
    delayMs = Math.min(delayMs * 2, maxDelayMs);
    status.replace(BACKGROUND_CONTEXT, { status: "disconnected", reason, retryInMs: wait });
    if (wait !== null) retryTimer = setTimeout(() => void establish(false), wait);
  };

  // Exactly one bootstrap/handshake/rebind attempt can run at a time. Its controller is also its identity.
  const establish = async (initial: boolean): Promise<void> => {
    if (closed || unauthorized || active !== undefined) return;
    clearRetry();
    const attempt = new AbortController();
    active = attempt;
    status.replace(BACKGROUND_CONTEXT, { status: "connecting" });
    let failure: Error | undefined;
    try {
      await withDeadline(
        async (signal) => {
          if (!initial) await bootstrap(baseUrl, options.token, signal);
          signal.throwIfAborted();
          transportSignal = signal;
          await client.connect();
          await transitions;
          signal.throwIfAborted();
        },
        CONNECTION_TIMEOUT_MS,
        attempt.signal,
      );
    } catch (error) {
      if (active !== attempt || closed) return;
      failure = toError(error);
      if (error instanceof BootstrapError && error.status === 401) {
        unauthorized = true;
        stopWake();
        clearInterval(heartbeat);
        status.replace(BACKGROUND_CONTEXT, { status: "unauthorized" });
      }
      client.disconnect(failure.message);
      if (initial) throw error;
    } finally {
      if (active === attempt) active = undefined;
    }
    if (failure !== undefined) scheduleReconnect(failure.message);
    else if (!client.connected) scheduleReconnect("Disconnected");
  };

  // This read-only RPC travels over the existing socket, not a separate HTTP connection.
  const checkConnection = (): void => {
    if (closed || unauthorized || !client.connected || active !== undefined || probe !== undefined) return;
    const checking = new AbortController();
    const current = generation;
    probe = checking;
    void withDeadline(
      (signal) => client.serviceCatalogue({ serverId: client.serverId }, signal),
      PROBE_TIMEOUT_MS,
      checking.signal,
    )
      .catch(() => {
        if (closed || unauthorized || probe !== checking || current !== generation) return;
        client.disconnect("Connection probe timed out or failed");
        // A failed probe already waited for its deadline; do not add backoff before the first recovery attempt.
        if (reconnect !== undefined) void establish(false);
      })
      .finally(() => {
        if (probe === checking) probe = undefined;
      });
  };

  const stopListening = client.onConnectionStateChange(({ state, error }) => {
    if (closed) return;
    if (state === "connected") {
      const current = ++generation;
      delayMs = initialDelayMs;
      rebind(true, BACKGROUND_CONTEXT);
      transitions = transitions.then(() => {
        if (!closed && !unauthorized && current === generation && client.connected)
          status.replace(BACKGROUND_CONTEXT, { status: "connected" });
      });
    } else if (state === "disconnected") {
      generation += 1;
      const previous = probe;
      probe = undefined;
      previous?.abort();
      rebind(false, BACKGROUND_CONTEXT);
      scheduleReconnect(error?.message ?? "Disconnected");
    }
  });

  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    closed = true;
    stopWake();
    clearInterval(heartbeat);
    clearRetry();
    options.signal?.removeEventListener("abort", onAbort);
    stopListening();
    const previous = active;
    active = undefined;
    previous?.abort();
    probe?.abort();
    probe = undefined;
    // Reject outstanding RPCs before waiting for binding cleanup.
    client.disconnect();
    closePromise = (async () => {
      await transitions;
      await binding.dispose(BACKGROUND_CONTEXT);
      await client.dispose();
    })();
    return closePromise;
  };
  const onAbort = (): void => {
    void close().catch(onError);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    options.signal?.throwIfAborted();
    await establish(true);
    options.signal?.throwIfAborted();
  } catch (error) {
    await close();
    throw error;
  }
  stopWake = onConnectionWake(() => {
    if (closed || unauthorized || reconnect === undefined || active !== undefined) return;
    if (client.connected) checkConnection();
    else {
      delayMs = initialDelayMs;
      void establish(false);
    }
  });
  heartbeat = setInterval(() => {
    if (typeof document === "undefined" || document.visibilityState !== "hidden") checkConnection();
  }, PROBE_INTERVAL_MS);

  return {
    deviceId,
    services: binding,
    status,
    terminal: (id, screen, terminalOptions = {}) =>
      new TerminalConnection({ baseUrl, token: options.token, id, screen, ...terminalOptions }),
    imageUrl: (ref) => new URL(imagePath(client.serverId, ref), baseUrl).href,
    async image(ref, signal) {
      const response = await fetch(new URL(imagePath(client.serverId, ref), baseUrl), {
        headers: options.token === undefined ? {} : { authorization: `Bearer ${options.token}` },
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) throw new Error(`The image could not be loaded (status ${response.status})`);
      return response.blob();
    },
    close,
  };
}

async function bootstrap(baseUrl: URL, token: string | undefined, signal: AbortSignal): Promise<BootstrapResponse> {
  const response = await fetch(new URL(BOOTSTRAP_PATH, baseUrl), {
    signal,
    cache: "no-store",
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new BootstrapError(response.status);
  return (await response.json()) as BootstrapResponse;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
