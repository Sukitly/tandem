import type { ByteTransport, ByteTransportFactory } from "@earendil-works/pi-client";

import { authenticatedSocket } from "./authenticated-socket.ts";

export interface WebSocketTransportOptions {
  token?: string;
  /** Cancels socket creation and the protocol handshake, including a socket that never opens. */
  signal?: AbortSignal;
  /**
   * Pause `send()` while more than this many bytes wait in the socket's send buffer. Browsers expose no drain event,
   * so the buffer is polled.
   */
  highWaterMark?: number;
  /** Poll interval while waiting for the send buffer to drain. */
  drainPollMs?: number;
}

const DEFAULT_HIGH_WATER_MARK = 1024 * 1024;
const DEFAULT_DRAIN_POLL_MS = 10;

/**
 * A pi-client byte transport over one WebSocket. Every message is binary; pi-protocol frames are length-prefixed, so
 * message boundaries carry no meaning. Works with the WebSocket of browsers and of Node 22 or later.
 */
export function createWebSocketTransportFactory(
  url: string | URL,
  options: WebSocketTransportOptions = {},
): ByteTransportFactory {
  const highWaterMark = options.highWaterMark ?? DEFAULT_HIGH_WATER_MARK;
  const drainPollMs = options.drainPollMs ?? DEFAULT_DRAIN_POLL_MS;

  return (handlers) =>
    new Promise<ByteTransport>((resolve, reject) => {
      options.signal?.throwIfAborted();
      const socket = authenticatedSocket(url, options.token);
      socket.binaryType = "arraybuffer";
      let opened = false;
      let terminated = false;

      const terminate = (report: () => void): void => {
        if (terminated) return;
        terminated = true;
        options.signal?.removeEventListener("abort", abort);
        report();
      };

      const abort = (): void => {
        const error = new Error("WebSocket connection cancelled");
        terminate(() => {
          if (!opened) reject(error);
          else handlers.onError(error);
        });
        socket.close();
      };
      options.signal?.addEventListener("abort", abort, { once: true });

      const waitForDrain = async (): Promise<void> => {
        while (!terminated && socket.readyState === WebSocket.OPEN && socket.bufferedAmount > highWaterMark) {
          await new Promise((resume) => setTimeout(resume, drainPollMs));
        }
      };

      let sendTail: Promise<void> = Promise.resolve();
      const transport: ByteTransport = {
        send(chunk) {
          const sent = sendTail.then(async () => {
            if (terminated || socket.readyState !== WebSocket.OPEN) throw new Error("WebSocket is not open");
            // Copy into a plain ArrayBuffer view: WebSocket.send() does not accept views of shared buffers.
            socket.send(new Uint8Array(chunk));
            await waitForDrain();
          });
          sendTail = sent.catch(() => {});
          return sent;
        },
        close() {
          terminate(() => {});
          if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close(1000);
        },
      };

      socket.addEventListener("open", () => {
        if (terminated) return;
        opened = true;
        resolve(transport);
      });
      socket.addEventListener("message", (event) => {
        if (terminated) return;
        if (event.data instanceof ArrayBuffer) {
          handlers.onData(new Uint8Array(event.data));
          return;
        }
        terminate(() => handlers.onError(new Error("Received a non-binary WebSocket message")));
        socket.close(1003);
      });
      socket.addEventListener("error", () => {
        if (!opened) return; // The close event that follows rejects the connection attempt.
        terminate(() => handlers.onError(new Error("WebSocket transport failed")));
      });
      socket.addEventListener("close", (event) => {
        if (!opened) {
          terminate(() => reject(new Error(`WebSocket closed before opening (code ${event.code})`)));
          return;
        }
        terminate(() => handlers.onClose());
      });
    });
}
