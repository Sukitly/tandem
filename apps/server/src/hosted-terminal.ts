import {
  clampTerminalSize,
  TERMINAL_CLOSED,
  TERMINAL_SCROLLBACK,
  type TerminalEvent,
  type TerminalSize,
} from "@tandem/contracts";
import SerializeModule from "@xterm/addon-serialize";
import HeadlessModule from "@xterm/headless";
import { type IPty, spawn } from "node-pty";

// Both are CommonJS: Node gives their exports as the default export only.
const { Terminal: Screen } = HeadlessModule;
const { SerializeAddon } = SerializeModule;
type Screen = InstanceType<typeof Screen>;

/** Output a page may have unsent before it is dropped behind and caught up with a screen instead. */
const MAX_BEHIND_BYTES = 4 * 1024 * 1024;
/** Output the server's screen may have unparsed before the shell is paused. */
const MAX_UNPARSED_BYTES = 1024 * 1024;

/** Where a terminal's events go for one page: a WebSocket, or a test's recorder. */
export interface TerminalPeer {
  sendBytes(data: Uint8Array): void;
  sendEvent(event: TerminalEvent): void;
  /** Bytes sent and not yet written to the connection. */
  readonly behind: number;
  /** The terminal is gone: close with `code`. */
  close(code: number): void;
}

export interface HostedTerminalOptions {
  /** Given by the host, which lists the terminal under it. */
  id: string;
  /** The project's directory, resolved. */
  cwd: string;
  size: TerminalSize;
  /** The program and its arguments; the user's login shell by default. */
  command?: readonly string[];
  onExit(exit: { code: number; signal?: number }): void;
}

/**
 * A terminal the server hosts: a shell on a pseudo-terminal (node-pty), the screen it draws, kept on the server
 * (`@xterm/headless`), and the pages that show it. A page that connects is sent that screen first, then the output that
 * follows, so it shows what a terminal that was always open would show.
 */
export class HostedTerminal {
  readonly id: string;
  readonly #pty: IPty;
  readonly #screen: Screen;
  readonly #serialize = new SerializeAddon();
  readonly #peers = new Map<TerminalPeer, { live: boolean }>();
  #unparsed = 0;
  #paused = false;
  #ended = false;
  #disposed = false;

  constructor(options: HostedTerminalOptions) {
    this.id = options.id;
    const size = clampTerminalSize(options.size);
    const [file, ...args] = options.command ?? [process.env.SHELL || "/bin/sh", "-l"];
    this.#screen = new Screen({ ...size, scrollback: TERMINAL_SCROLLBACK, allowProposedApi: true });
    this.#screen.loadAddon(this.#serialize);
    try {
      this.#pty = spawn(file as string, args, {
        name: "xterm-256color",
        cwd: options.cwd,
        ...size,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>,
        // Bytes, not text: a character may arrive split over two reads.
        encoding: null,
      });
    } catch (error) {
      this.#screen.dispose();
      throw error;
    }
    this.#pty.onData((data) => this.#output(data as unknown as Buffer));
    this.#pty.onExit(({ exitCode, signal }) => {
      if (this.#disposed) return;
      this.#ended = true;
      // A signal reports exit code 0: the signal is what ended it.
      options.onExit({ code: exitCode, ...(signal ? { signal } : {}) });
    });
  }

  get size(): TerminalSize {
    return { cols: this.#screen.cols, rows: this.#screen.rows };
  }

  /** The user's input, as bytes. */
  write(data: Uint8Array): void {
    if (!this.#ended && !this.#disposed) this.#pty.write(Buffer.from(data));
  }

  /** The newest size wins: a pseudo-terminal has one, whatever pages show it. */
  resize(size: TerminalSize): void {
    const next = clampTerminalSize(size);
    if (this.#disposed || (next.cols === this.#screen.cols && next.rows === this.#screen.rows)) return;
    if (!this.#ended) this.#pty.resize(next.cols, next.rows);
    this.#screen.resize(next.cols, next.rows);
    for (const [peer, state] of this.#peers) if (state.live) peer.sendEvent({ type: "resize", ...next });
  }

  /** Start sending to a page: the screen, then every output after it. */
  attach(peer: TerminalPeer): () => void {
    if (this.#disposed) {
      peer.close(TERMINAL_CLOSED);
      return () => {};
    }
    this.#peers.set(peer, { live: false });
    this.#sendScreen(peer);
    return () => {
      this.#peers.delete(peer);
    };
  }

  /** End the shell and close every page's connection. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const peer of this.#peers.keys()) peer.close(TERMINAL_CLOSED);
    this.#peers.clear();
    if (!this.#ended) {
      try {
        this.#pty.kill();
      } catch {
        // The shell ended on its own meanwhile.
      }
    }
    this.#screen.dispose();
  }

  #output(data: Buffer): void {
    this.#unparsed += data.length;
    if (!this.#paused && this.#unparsed > MAX_UNPARSED_BYTES) {
      this.#paused = true;
      this.#pty.pause();
    }
    // Pages are sent the bytes once the screen has them, so a screen sent to a page is never ahead of what follows it.
    this.#screen.write(data, () => {
      this.#unparsed -= data.length;
      if (this.#paused && this.#unparsed <= MAX_UNPARSED_BYTES / 2 && !this.#disposed) {
        this.#paused = false;
        this.#pty.resume();
      }
      for (const [peer, state] of this.#peers) {
        if (!state.live) continue;
        if (peer.behind > MAX_BEHIND_BYTES) {
          // Too far behind to catch up byte by byte: it gets the screen again once it has sent what it has.
          state.live = false;
          this.#sendScreen(peer);
        } else {
          peer.sendBytes(data);
        }
      }
    });
  }

  /**
   * Send the screen once the screen has parsed what was written so far; a callback of the screen runs after the data
   * written before it and before any written after it, so the page then goes on from exactly there.
   */
  #sendScreen(peer: TerminalPeer): void {
    const whenDrained = (): void => {
      if (!this.#peers.has(peer) || this.#disposed) return;
      if (peer.behind > 0) {
        setTimeout(whenDrained, 50);
        return;
      }
      this.#screen.write("", () => {
        const current = this.#peers.get(peer);
        if (current === undefined || this.#disposed) return;
        peer.sendEvent({ type: "screen", data: this.#serialize.serialize(), ...this.size });
        current.live = true;
      });
    };
    whenDrained();
  }
}
