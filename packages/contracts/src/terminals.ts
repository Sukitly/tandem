import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";

/** A shell running in a project's directory. Its bytes go over `/pty/<id>`, not over this list. */
export type TerminalSummary = {
  /** Random; connecting also requires a valid device session or the installation master key. */
  id: string;
  workspaceId: number;
  /** "Terminal 1", "Terminal 2", … in the order they were opened in the project. */
  title: string;
  /**
   * Set once the shell has ended; the terminal stays until it is closed. `signal` is set when a signal ended it, and
   * `code` is then 0. This is the only place a page learns that a shell ended.
   */
  exit?: { code: number; signal?: number };
};

export type TerminalsState = {
  /** In the order they were opened. */
  terminals: TerminalSummary[];
};

/** Terminals one project may have open at once. */
export const MAX_TERMINALS_PER_PROJECT = 10;

/** Lines a terminal keeps above its screen, on the server and in the page. */
export const TERMINAL_SCROLLBACK = 5_000;

/** The size of a terminal, in character cells. */
export type TerminalSize = { cols: number; rows: number };

/** The size a shell starts at, until the first page to connect sends its own. */
export const TERMINAL_START_SIZE: TerminalSize = { cols: 80, rows: 24 };

/**
 * The sizes a terminal can be. A size outside them is clamped to them: a page's box may be that small or that large.
 * A size that is not whole numbers is refused: that is a page that does not speak the protocol.
 */
export const TERMINAL_MIN_SIZE: TerminalSize = { cols: 2, rows: 1 };
export const TERMINAL_MAX_SIZE: TerminalSize = { cols: 1000, rows: 500 };

/** A size within what a terminal can be. */
export function clampTerminalSize(size: TerminalSize): TerminalSize {
  const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.floor(value)));
  return {
    cols: clamp(size.cols, TERMINAL_MIN_SIZE.cols, TERMINAL_MAX_SIZE.cols),
    rows: clamp(size.rows, TERMINAL_MIN_SIZE.rows, TERMINAL_MAX_SIZE.rows),
  };
}

/**
 * A message from a page to a terminal, sent as a WebSocket text frame. Binary frames carry the user's input, as bytes.
 */
export type TerminalControl = { type: "resize"; cols: number; rows: number };

/**
 * A message from a terminal to a page, sent as a text frame. Binary frames carry the shell's output, as bytes. A page
 * that connects first receives `screen` and then the output after it; one that fell behind receives `screen` again.
 */
export type TerminalEvent =
  | { type: "screen"; data: string; cols: number; rows: number }
  | { type: "resize"; cols: number; rows: number };

/**
 * Close codes of a terminal's socket. The server closes it with `TERMINAL_CLOSED` once the terminal is gone, and with
 * `TERMINAL_BAD_MESSAGE` when the page sent a control message it does not understand: the terminal is still there.
 */
export const TERMINAL_CLOSED = 1000;
export const TERMINAL_BAD_MESSAGE = 1003;

/**
 * The terminals of every project, shared by all pages: a terminal outlives the page that opened it, and stops with the
 * server or with its project. Stopping an agent does not touch them.
 */
export interface Terminals {
  readonly state: ReplicatedState<TerminalsState>;
  /**
   * Start a shell in a project's directory, at `TERMINAL_START_SIZE` until a page sends its size. Returns the
   * terminal's ID.
   */
  create(input: { workspaceId: number }, context: Context): Promise<string>;
  /** End the shell, if it still runs, and take the terminal off the list. */
  close(id: string, context: Context): Promise<void>;
}

export const Terminals = defineService<Terminals>("tandem.terminals");

/** The WebSocket path of one terminal. */
export function terminalPath(id: string): string {
  return `/pty/${encodeURIComponent(id)}`;
}

/** How a shell's end is shown: by its signal, when a signal ended it. */
export function exitLabel(exit: { code: number; signal?: number }): string {
  return exit.signal === undefined ? `Exited ${exit.code}` : `Killed (signal ${exit.signal})`;
}
