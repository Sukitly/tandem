import { randomUUID } from "node:crypto";
import type { TerminalEvent, TerminalSize } from "@tandem/contracts";
import { TERMINAL_SCROLLBACK } from "@tandem/contracts";
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

export const MIN_COLS = 2;
export const MAX_COLS = 1000;
export const MIN_ROWS = 1;
export const MAX_ROWS = 500;

/** Where a terminal's events go for one page: a WebSocket, or a test's recorder. */
export interface TerminalPeer {
  sendBytes(data: Uint8Array): void;
  sendEvent(event: TerminalEvent): void;
  /** Bytes sent and not yet written to the connection. */
  readonly behind: number;
  close(): void;
}

export interface PtyOptions {
  cwd: string;
  size: TerminalSize;
  /** The program and its arguments; the user's login shell by default. */
  command?: readonly string[];
  onExit(exit: { code: number; signal?: number }): void;
}

/**
 * One shell on a pseudo-terminal, and the screen it draws, kept on the server: a page that connects is sent that
 * screen first, then the output that follows, so it shows what a terminal that was always open would show.
 */
export class Pty {
  readonly id = randomUUID();
  readonly #pty: IPty;
  readonly #screen: Screen;
  readonly #serialize = new SerializeAddon();
  readonly #peers = new Map<TerminalPeer, { live: boolean }>();
  readonly #onExit: PtyOptions["onExit"];
  #unparsed = 0;
  #paused = false;
  #exit: { code: number; signal?: number } | undefined;
  #disposed = false;

  constructor(options: PtyOptions) {
    const size = clampSize(options.size);
    const [file, ...args] = options.command ?? [process.env.SHELL || "/bin/sh", "-l"];
    this.#screen = new Screen({ ...size, scrollback: TERMINAL_SCROLLBACK, allowProposedApi: true });
    this.#screen.loadAddon(this.#serialize);
    this.#onExit = options.onExit;
    this.#pty = spawn(file as string, args, {
      name: "xterm-256color",
      cwd: options.cwd,
      ...size,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>,
      // Bytes, not text: a character may arrive split over two reads.
      encoding: null,
    });
    this.#pty.onData((data) => this.#output(data as unknown as Buffer));
    this.#pty.onExit(({ exitCode, signal }) => {
      // Ended by `dispose()`: the screen is gone, and so is the terminal.
      if (this.#disposed) return;
      // The screen takes what was written before the exit, so the exit comes after the last output.
      this.#screen.write("", () => {
        if (this.#disposed) return;
        this.#exit = { code: exitCode, ...(signal ? { signal } : {}) };
        for (const [peer, state] of this.#peers) if (state.live) peer.sendEvent({ type: "exit", ...this.#exit });
        this.#onExit(this.#exit);
      });
    });
  }

  get size(): TerminalSize {
    return { cols: this.#screen.cols, rows: this.#screen.rows };
  }

  /** The user's input, as the page encoded it. */
  write(data: Uint8Array): void {
    if (this.#exit === undefined && !this.#disposed) this.#pty.write(Buffer.from(data));
  }

  /** The newest size wins: a pseudo-terminal has one, whatever pages show it. */
  resize(size: TerminalSize): void {
    const next = clampSize(size);
    if (this.#disposed || (next.cols === this.#screen.cols && next.rows === this.#screen.rows)) return;
    if (this.#exit === undefined) this.#pty.resize(next.cols, next.rows);
    this.#screen.resize(next.cols, next.rows);
    for (const [peer, state] of this.#peers) if (state.live) peer.sendEvent({ type: "resize", ...next });
  }

  /** Start sending to a page: the screen, then every output after it. */
  attach(peer: TerminalPeer): () => void {
    if (this.#disposed) {
      peer.close();
      return () => {};
    }
    this.#peers.set(peer, { live: false });
    this.#sendScreen(peer);
    return () => {
      this.#peers.delete(peer);
    };
  }

  /** End the shell and drop every page. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const peer of this.#peers.keys()) peer.close();
    this.#peers.clear();
    if (this.#exit === undefined) {
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
      const state = this.#peers.get(peer);
      if (state === undefined || this.#disposed) return;
      if (peer.behind > 0) {
        setTimeout(whenDrained, 50);
        return;
      }
      this.#screen.write("", () => {
        const current = this.#peers.get(peer);
        if (current === undefined || this.#disposed) return;
        peer.sendEvent({ type: "screen", data: this.#serialize.serialize(), ...this.size });
        if (this.#exit !== undefined) peer.sendEvent({ type: "exit", ...this.#exit });
        current.live = true;
      });
    };
    whenDrained();
  }
}

/** A size within what a terminal can be, from a page's numbers. */
export function clampSize(size: TerminalSize): TerminalSize {
  const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, Math.floor(Number.isFinite(value) ? value : min)));
  return { cols: clamp(size.cols, MIN_COLS, MAX_COLS), rows: clamp(size.rows, MIN_ROWS, MAX_ROWS) };
}
