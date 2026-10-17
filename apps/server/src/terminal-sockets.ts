import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { TERMINAL_BAD_MESSAGE, type TerminalControl, type TerminalEvent } from "@tandem/contracts";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import type { HostedTerminal, TerminalPeer } from "./hosted-terminal.ts";
import { startSocketHeartbeat } from "./socket-heartbeat.ts";

/** Largest message a page may send: input is typed or pasted. */
const MAX_INPUT_BYTES = 1024 * 1024;
const DEFAULT_PING_INTERVAL_MS = 30_000;

export interface TerminalSocketsOptions {
  /**
   * Interval in milliseconds between keepalive ping frames. Set to 0 to disable.
   * Keeps mobile/NAT connections alive and detects dead sockets. Defaults to 30,000ms.
   */
  pingIntervalMs?: number;
}

/**
 * The WebSocket side of `/pty/<id>`: binary frames are bytes each way, text frames are JSON control messages. The
 * caller has authorized the upgrade already.
 */
export class TerminalSockets {
  readonly #pingIntervalMs: number;
  readonly #server = new WebSocketServer({ noServer: true, maxPayload: MAX_INPUT_BYTES });
  readonly #sockets = new Set<WebSocket>();

  constructor(options: TerminalSocketsOptions = {}) {
    this.#pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  }

  handleUpgrade(terminal: HostedTerminal, request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.#server.handleUpgrade(request, socket, head, (webSocket) => this.#accept(terminal, webSocket));
  }

  close(): void {
    for (const socket of this.#sockets) socket.terminate();
    this.#sockets.clear();
    this.#server.close();
  }

  #accept(terminal: HostedTerminal, socket: WebSocket): void {
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
      close: (code) => socket.close(code, "Terminal closed"),
    };
    const detach = terminal.attach(peer);
    startSocketHeartbeat(socket, this.#pingIntervalMs);
    socket.on("message", (data: RawData, isBinary: boolean) => {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      if (isBinary) {
        terminal.write(bytes);
        return;
      }
      const control = parseControl(bytes.toString("utf8"));
      if (control === undefined) socket.close(TERMINAL_BAD_MESSAGE, "Unknown control message");
      else if (control.type === "ping") peer.sendEvent({ type: "pong", id: control.id });
      else terminal.resize(control);
    });
    socket.on("close", () => {
      this.#sockets.delete(socket);
      detach();
    });
    socket.on("error", () => socket.terminate());
  }
}

function parseControl(text: string): TerminalControl | undefined {
  try {
    const { type, cols, rows, id } = JSON.parse(text) as {
      type?: unknown;
      cols?: unknown;
      rows?: unknown;
      id?: unknown;
    };
    if (type === "ping" && Number.isSafeInteger(id)) return { type, id: id as number };
    if (type !== "resize" || !Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) return undefined;
    return { type, cols: cols as number, rows: rows as number };
  } catch {
    return undefined;
  }
}
