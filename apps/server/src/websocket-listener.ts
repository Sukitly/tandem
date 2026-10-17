import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ServerListener } from "@earendil-works/pi-server";
import { type WebSocket, WebSocketServer } from "ws";
import { startSocketHeartbeat } from "./socket-heartbeat.ts";

export interface WebSocketListenerOptions {
  /** Largest WebSocket message accepted from a client. */
  maxPayload?: number;
  /** Outbound bytes that may wait for the socket before `send()` rejects. */
  maxPendingBytes?: number;
  /** How long `close()` waits for the closing handshake before terminating the socket. */
  gracefulCloseTimeoutMs?: number;
  /**
   * Interval in milliseconds between keepalive ping frames. Set to 0 to disable.
   * Keeps mobile/NAT connections alive and detects dead sockets. Defaults to 30,000ms.
   */
  pingIntervalMs?: number;
  onError?: (error: Error) => void;
}

/** pi-server does not export these from its package root. */
type ByteConnectionAcceptor = Parameters<ServerListener["start"]>[0];
type ByteConnection = Parameters<ByteConnectionAcceptor>[0];

const DEFAULT_MAX_PAYLOAD = 64 * 1024 * 1024;
const DEFAULT_GRACEFUL_CLOSE_TIMEOUT_MS = 1_000;
const DEFAULT_PING_INTERVAL_MS = 30_000;

/**
 * A pi-server listener for WebSocket connections. It does not own an HTTP server: the caller authorizes each upgrade
 * request and then hands it over with `handleUpgrade()`.
 */
export class WebSocketListener implements ServerListener {
  readonly #options: Required<Omit<WebSocketListenerOptions, "onError">> & Pick<WebSocketListenerOptions, "onError">;
  readonly #server: WebSocketServer;
  readonly #connections = new Set<WebSocketByteConnection>();
  #accept: ByteConnectionAcceptor | undefined;
  #closing = false;

  constructor(options: WebSocketListenerOptions = {}) {
    const maxPayload = options.maxPayload ?? DEFAULT_MAX_PAYLOAD;
    this.#options = {
      maxPayload,
      maxPendingBytes: options.maxPendingBytes ?? maxPayload * 4,
      gracefulCloseTimeoutMs: options.gracefulCloseTimeoutMs ?? DEFAULT_GRACEFUL_CLOSE_TIMEOUT_MS,
      pingIntervalMs: options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS,
      onError: options.onError,
    };
    this.#server = new WebSocketServer({ noServer: true, maxPayload });
  }

  async start(accept: ByteConnectionAcceptor): Promise<void> {
    if (this.#accept !== undefined) throw new Error("WebSocket listener is already started");
    if (this.#closing) throw new Error("WebSocket listener is closed");
    this.#accept = accept;
  }

  /** Complete an upgrade request that the caller has already authorized. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (this.#accept === undefined || this.#closing) {
      socket.destroy();
      return;
    }
    this.#server.handleUpgrade(request, socket, head, (webSocket) => this.#acceptSocket(webSocket));
  }

  async close(): Promise<void> {
    this.#closing = true;
    await Promise.all([...this.#connections].map((connection) => connection.close()));
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  #acceptSocket(webSocket: WebSocket): void {
    const accept = this.#accept;
    if (accept === undefined || this.#closing) {
      webSocket.terminate();
      return;
    }
    const connection = new WebSocketByteConnection(
      webSocket,
      this.#options.maxPendingBytes,
      this.#options.gracefulCloseTimeoutMs,
    );
    this.#connections.add(connection);
    const handler = accept(connection);
    startSocketHeartbeat(webSocket, this.#options.pingIntervalMs);
    webSocket.on("message", (data, isBinary) => {
      if (!isBinary) {
        handler.onError(new Error("Received a non-binary WebSocket message"));
        webSocket.close(1003);
        return;
      }
      for (const chunk of toChunks(data)) handler.onData(chunk);
    });
    webSocket.on("error", (error) => {
      this.#reportError(error);
      handler.onError(error);
      webSocket.terminate();
    });
    webSocket.once("close", () => {
      connection.markClosed();
      this.#connections.delete(connection);
      handler.onClose();
    });
  }

  #reportError(error: Error): void {
    try {
      this.#options.onError?.(error);
    } catch {
      // Error observers cannot affect listener state.
    }
  }
}

/** One WebSocket as an ordered pi-server byte connection. `send()` settles once `ws` has written the chunk. */
export class WebSocketByteConnection implements ByteConnection {
  readonly #socket: WebSocket;
  readonly #maxPendingBytes: number;
  readonly #gracefulCloseTimeoutMs: number;
  #pendingBytes = 0;
  #closed = false;
  #closePromise: Promise<void> | undefined;
  #resolveClose: (() => void) | undefined;

  constructor(socket: WebSocket, maxPendingBytes: number, gracefulCloseTimeoutMs: number) {
    this.#socket = socket;
    this.#maxPendingBytes = maxPendingBytes;
    this.#gracefulCloseTimeoutMs = gracefulCloseTimeoutMs;
  }

  get closed(): boolean {
    return this.#closed;
  }

  send(chunk: Uint8Array): Promise<void> {
    if (this.#closed || this.#closePromise !== undefined || this.#socket.readyState !== this.#socket.OPEN) {
      return Promise.reject(new Error("WebSocket connection is closed"));
    }
    if (this.#pendingBytes + chunk.byteLength > this.#maxPendingBytes) {
      return Promise.reject(new Error("WebSocket connection exceeded its pending byte limit"));
    }
    this.#pendingBytes += chunk.byteLength;
    const bytes = chunk.slice();
    return new Promise<void>((resolve, reject) => {
      this.#socket.send(bytes, { binary: true }, (error) => {
        this.#pendingBytes -= bytes.byteLength;
        if (error) reject(error);
        else resolve();
      });
    });
  }

  close(finalChunk?: Uint8Array): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#closePromise !== undefined) return this.#closePromise;
    this.#closePromise = new Promise<void>((resolve) => {
      this.#resolveClose = resolve;
      const timer = setTimeout(() => {
        this.#socket.terminate();
        this.markClosed();
      }, this.#gracefulCloseTimeoutMs);
      timer.unref();
      const finish = (): void => this.#socket.close(1000);
      if (finalChunk !== undefined && this.#socket.readyState === this.#socket.OPEN) {
        this.#socket.send(finalChunk.slice(), { binary: true }, finish);
      } else {
        finish();
      }
    });
    return this.#closePromise;
  }

  markClosed(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#resolveClose?.();
    this.#resolveClose = undefined;
  }
}

function toChunks(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array[] {
  if (Array.isArray(data))
    return data.map((buffer) => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  if (data instanceof ArrayBuffer) return [new Uint8Array(data)];
  return [new Uint8Array(data.buffer, data.byteOffset, data.byteLength)];
}
