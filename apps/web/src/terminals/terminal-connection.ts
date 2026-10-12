import {
  TERMINAL_SCROLLBACK,
  type TerminalControl,
  type TerminalEvent,
  type TerminalSize,
  TOKEN_QUERY_PARAMETER,
  terminalPath,
} from "@tandem/contracts";

/** What a terminal's connection needs of the screen that shows it: an xterm `Terminal`, or a test's recorder. */
export interface TerminalScreen {
  /** Draw bytes or text; `done` runs once they are drawn. */
  write(data: Uint8Array | string, done?: () => void): void;
  reset(): void;
  resize(cols: number, rows: number): void;
}

export type TerminalLink = "connecting" | "open" | "closed";

export interface TerminalConnectionOptions {
  /** The page's origin: `/pty` is served beside the page. */
  origin: string;
  token: string;
  id: string;
  screen: TerminalScreen;
  /** The connection's state changed. */
  onLink?(link: TerminalLink): void;
  /** Builds the socket; the browser's `WebSocket` by default. */
  socket?: (url: string) => WebSocket;
}

/** How long to wait before connecting again, after the first failure and at most. */
const RETRY_MS = [250, 5_000] as const;

/**
 * One page's connection to a terminal on the server. The server sends the screen first, so connecting again after a
 * drop shows the terminal as it is; the page's own screen is reset before it is drawn.
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

  /** The user's input, as xterm encodes it. */
  input(data: string): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(new TextEncoder().encode(data));
  }

  /** The size the page fits the terminal to. Sent now if it is connected, and on every later connection. */
  resize(size: TerminalSize): void {
    this.#size = size;
    this.#sendSize();
  }

  close(): void {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#socket?.close(1000);
    this.#socket = undefined;
  }

  #connect(): void {
    const url = new URL(terminalPath(this.#options.id), this.#options.origin);
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
      this.#options.onLink?.("closed");
      // Closed on purpose by the server: the terminal is gone. Otherwise the connection dropped, and is tried again.
      if (this.#closed || event.code === 1000 || event.code === 1003) return;
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
      case "exit":
        // The list shows that the shell ended; the screen keeps what it printed.
        return;
    }
  }

  #sendSize(): void {
    if (this.#size === undefined || this.#socket?.readyState !== WebSocket.OPEN) return;
    const control: TerminalControl = { type: "resize", ...this.#size };
    this.#socket.send(JSON.stringify(control));
  }
}

/** The options a page's terminal is drawn with: the server keeps as many lines. */
export const TERMINAL_OPTIONS = {
  scrollback: TERMINAL_SCROLLBACK,
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  cursorBlink: true,
  allowProposedApi: false,
} as const;
