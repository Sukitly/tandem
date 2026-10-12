import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { TerminalEvent } from "@tandem/contracts";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import type { Pty, TerminalPeer } from "./pty.ts";

/** Largest message a page may send: input is typed or pasted. */
const MAX_INPUT_BYTES = 1024 * 1024;

/**
 * The WebSocket side of `/pty/<id>`: binary frames are bytes each way, text frames are JSON control messages. The
 * caller has authorized the upgrade already.
 */
export class TerminalSockets {
  readonly #server = new WebSocketServer({ noServer: true, maxPayload: MAX_INPUT_BYTES });
  readonly #sockets = new Set<WebSocket>();

  handleUpgrade(pty: Pty, request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.#server.handleUpgrade(request, socket, head, (webSocket) => this.#accept(pty, webSocket));
  }

  close(): void {
    for (const socket of this.#sockets) socket.terminate();
    this.#sockets.clear();
    this.#server.close();
  }

  #accept(pty: Pty, socket: WebSocket): void {
    this.#sockets.add(socket);
    const peer: TerminalPeer = {
      sendBytes: (data) => {
        if (socket.readyState === socket.OPEN) socket.send(data, { binary: true });
      },
      sendEvent: (event: TerminalEvent) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event), { binary: false });
      },
      get behind() {
        return socket.bufferedAmount;
      },
      close: () => socket.close(1000, "Terminal closed"),
    };
    const detach = pty.attach(peer);
    socket.on("message", (data: RawData, isBinary: boolean) => {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      if (isBinary) {
        pty.write(bytes);
        return;
      }
      const control = parseControl(bytes.toString("utf8"));
      if (control === undefined) socket.close(1003, "Unknown control message");
      else pty.resize(control);
    });
    socket.on("close", () => {
      this.#sockets.delete(socket);
      detach();
    });
    socket.on("error", () => socket.terminate());
  }
}

function parseControl(text: string): { cols: number; rows: number } | undefined {
  try {
    const { type, cols, rows } = JSON.parse(text) as { type?: unknown; cols?: unknown; rows?: unknown };
    if (type !== "resize" || !Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) return undefined;
    return { cols: cols as number, rows: rows as number };
  } catch {
    return undefined;
  }
}
