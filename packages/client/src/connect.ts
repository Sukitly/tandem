import {
  type Context,
  createRemoteServiceBinding,
  type RemoteServices,
  type ReplicatedState,
  replicatedState,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Client, createClientServiceTransport } from "@earendil-works/pi-client";
import {
  BOOTSTRAP_PATH,
  type BootstrapResponse,
  type ImageRef,
  imagePath,
  RPC_PATH,
  TOKEN_QUERY_PARAMETER,
} from "@tandem/contracts";
import { TerminalConnection, type TerminalConnectionOptions, type TerminalScreen } from "./terminal-connection.ts";
import { createWebSocketTransportFactory } from "./websocket-transport.ts";

export type ConnectionStatus =
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
  token: string;
  /** Services this connection binds. Only these can be used or observed. */
  services: readonly { readonly id: string }[];
  /** `false` disables reconnecting after the connection drops. */
  reconnect?: ReconnectOptions | false;
  onError?: (error: Error) => void;
}

export interface TandemConnection {
  /** Bound services. Handles stay valid across reconnects; their state rehydrates after each one. */
  readonly services: RemoteServices;
  /** `connected` is reported once the services are bound and can be called. */
  readonly status: ReplicatedState<ConnectionStatus>;
  /** Connect to a terminal's own socket, with this connection's server and token. */
  terminal(id: string, screen: TerminalScreen, options?: TerminalOptions): TerminalConnection;
  /** An image of a conversation's transcript, fetched with this connection's token. Rejects for anything but 200. */
  image(ref: ImageRef, signal?: AbortSignal): Promise<Blob>;
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
  const { serverId } = await bootstrap(baseUrl, options.token);

  const rpcUrl = new URL(RPC_PATH, baseUrl);
  rpcUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
  rpcUrl.searchParams.set(TOKEN_QUERY_PARAMETER, options.token);

  const client = new Client({
    serverId,
    transportFactory: createWebSocketTransportFactory(rpcUrl),
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

  // Rebinding is serialized so that bound and unbound transitions apply in connection order.
  let transitions = Promise.resolve();
  const rebind = (bound: boolean, context: Context): void => {
    transitions = transitions
      .then(() => binding.rebind(bound, context))
      .catch((error: unknown) => onError(toError(error)));
  };

  const scheduleReconnect = (reason: string): void => {
    if (closed || reconnect === undefined) {
      status.replace(BACKGROUND_CONTEXT, { status: "disconnected", reason, retryInMs: null });
      return;
    }
    if (retryTimer !== undefined) return;
    const wait = delayMs;
    delayMs = Math.min(delayMs * 2, maxDelayMs);
    status.replace(BACKGROUND_CONTEXT, { status: "disconnected", reason, retryInMs: wait });
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (closed) return;
      status.replace(BACKGROUND_CONTEXT, { status: "connecting" });
      // A failed attempt reports `disconnected` through the state listener, which schedules the next one.
      client.reconnect().catch(() => {});
    }, wait);
  };

  const stopListening = client.onConnectionStateChange(({ state, error }) => {
    // Closing disconnects the client too; the binding is disposed by then.
    if (closed) return;
    if (state === "connected") {
      delayMs = initialDelayMs;
      rebind(true, BACKGROUND_CONTEXT);
      // Reported once the services are bound, so that whoever reacts to it can call them.
      transitions = transitions.then(() => {
        if (client.connected) status.replace(BACKGROUND_CONTEXT, { status: "connected" });
      });
    } else if (state === "disconnected") {
      rebind(false, BACKGROUND_CONTEXT);
      scheduleReconnect(error?.message ?? "Disconnected");
    }
  });

  try {
    await client.connect();
  } catch (error) {
    closed = true;
    await client.dispose();
    throw error;
  }
  await transitions;

  return {
    services: binding,
    status,
    terminal: (id, screen, terminalOptions = {}) =>
      new TerminalConnection({ baseUrl, token: options.token, id, screen, ...terminalOptions }),
    async image(ref, signal) {
      const response = await fetch(new URL(imagePath(ref), baseUrl), {
        headers: { authorization: `Bearer ${options.token}` },
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) throw new Error(`The image could not be loaded (status ${response.status})`);
      return response.blob();
    },
    async close() {
      if (closed) return;
      closed = true;
      stopListening();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      await transitions;
      await binding.dispose(BACKGROUND_CONTEXT);
      await client.dispose();
    },
  };
}

async function bootstrap(baseUrl: URL, token: string): Promise<BootstrapResponse> {
  const response = await fetch(new URL(BOOTSTRAP_PATH, baseUrl), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new BootstrapError(response.status);
  return (await response.json()) as BootstrapResponse;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
