import {
  TERMINAL_BAD_MESSAGE,
  TERMINAL_CLOSED,
  type TerminalControl,
  type TerminalEvent,
  type TerminalSize,
  TOKEN_QUERY_PARAMETER,
  terminalPath,
} from "@tandem/contracts";

/** What a terminal's connection needs of the screen that shows it: an xterm `Terminal`, or a recorder. */
export interface TerminalScreen {
  /** Draw bytes or text. */
  write(data: Uint8Array | string): void;
  reset(): void;
  resize(cols: number, rows: number): void;
}

/**
 * The state of a terminal's connection. `closed` is final until `reconnect()`: the terminal is gone, or the page
 * sent what the server did not understand. A dropped connection is `connecting` again, by itself.
 */
export type TerminalLink = "connecting" | "open" | "closed";

export interface TerminalConnectionOptions {
  /** The server's origin. */
  baseUrl: URL;
  token: string;
  id: string;
  screen: TerminalScreen;
  onLink?(link: TerminalLink): void;
  /** Where a fault of the page's own is reported, such as a control message the server refused. */
  onError?(error: Error): void;
  /** Builds the socket; the global `WebSocket` by default, which browsers and Node 22 or later have. */
  socket?: (url: string) => WebSocket;
}

/** How long to wait before connecting again, after the first drop and at most. */
const RETRY_MS = [250, 5_000] as const;

/** The largest message input is sent in: the server refuses bigger ones, and a paste may be bigger. */
const MAX_INPUT_CHUNK = 64 * 1024;

/**
 * One connection to a terminal on the server, over its own WebSocket. The server sends the screen first, so connecting
 * again after a drop shows the terminal as it is; the screen here is reset before it is drawn.
 */
export class TerminalConnection {
  readonly #options: TerminalConnectionOptions;
  #socket: WebSocket | undefined;
  #retry = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;
  /** The size the page shows, sent on every connection: the newest size wins on the server. */
  #size: TerminalSize | undefined;

  constructor(options: TerminalConnectionOptions) {
    this.#options = options;
    this.#connect();
  }

  /** Text the user typed or pasted, as xterm's `onData` gives it: sent as UTF-8. */
  input(data: string): void {
    this.#send(new TextEncoder().encode(data));
  }

  /**
   * Bytes xterm gives as a string of one character per byte (`onBinary`), such as mouse reports: each character is
   * one byte, not UTF-8.
   */
  inputBinary(data: string): void {
    const bytes = new Uint8Array(data.length);
    for (let index = 0; index < data.length; index += 1) bytes[index] = data.charCodeAt(index) & 0xff;
    this.#send(bytes);
  }

  /** The size the page fits the terminal to. Sent now if it is connected, and on every later connection. */
  resize(size: TerminalSize): void {
    this.#size = size;
    this.#sendSize();
  }

  /** Connect again after the connection closed for good. */
  reconnect(): void {
    if (this.#closed || this.#socket !== undefined) return;
    clearTimeout(this.#timer);
    this.#retry = 0;
    this.#connect();
  }

  close(): void {
    this.#closed = true;
    clearTimeout(this.#timer);
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.close(TERMINAL_CLOSED);
  }

  #send(bytes: Uint8Array<ArrayBuffer>): void {
    const socket = this.#socket;
    if (socket?.readyState !== WebSocket.OPEN) return;
    for (let start = 0; start < bytes.length; start += MAX_INPUT_CHUNK) {
      socket.send(bytes.slice(start, start + MAX_INPUT_CHUNK));
    }
  }

  #connect(): void {
    const url = new URL(terminalPath(this.#options.id), this.#options.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set(TOKEN_QUERY_PARAMETER, this.#options.token);
    const socket = (this.#options.socket ?? ((target) => new WebSocket(target)))(url.toString());
    socket.binaryType = "arraybuffer";
    this.#socket = socket;
    this.#options.onLink?.("connecting");
    socket.onopen = () => {
      this.#retry = 0;
      this.#options.onLink?.("open");
      this.#sendSize();
    };
    socket.onmessage = (message: MessageEvent) => {
      if (typeof message.data === "string") this.#event(JSON.parse(message.data) as TerminalEvent);
      else this.#options.screen.write(new Uint8Array(message.data as ArrayBuffer));
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.#socket !== socket) return;
      this.#socket = undefined;
      if (this.#closed) return;
      if (event.code === TERMINAL_BAD_MESSAGE) {
        // The page's fault, not the terminal's: it is still there, and the user can connect again.
        this.#options.onError?.(new Error(`The terminal refused a message: ${event.reason || "bad message"}`));
      }
      if (event.code === TERMINAL_CLOSED || event.code === TERMINAL_BAD_MESSAGE) {
        this.#options.onLink?.("closed");
        return;
      }
      // Dropped: tried again, sooner first.
      this.#options.onLink?.("connecting");
      const delay = Math.min(RETRY_MS[1], RETRY_MS[0] * 2 ** this.#retry);
      this.#retry += 1;
      this.#timer = setTimeout(() => this.#connect(), delay);
    };
  }

  #event(event: TerminalEvent): void {
    const { screen } = this.#options;
    switch (event.type) {
      case "screen":
        screen.reset();
        screen.resize(event.cols, event.rows);
        screen.write(event.data);
        // The page's own size goes after the screen, so the server redraws for it once it is drawn.
        this.#sendSize();
        return;
      case "resize":
        screen.resize(event.cols, event.rows);
        return;
    }
  }

  #sendSize(): void {
    if (this.#size === undefined || this.#socket?.readyState !== WebSocket.OPEN) return;
    const control: TerminalControl = { type: "resize", ...this.#size };
    this.#socket.send(JSON.stringify(control));
  }
}
