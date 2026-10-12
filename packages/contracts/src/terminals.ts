import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";

/** A shell running in a project's directory. Its bytes go over `/pty/<id>`, not over this list. */
export type TerminalSummary = {
  /** Random: knowing it, with the token, is what connecting to the terminal takes. */
  id: string;
  workspaceId: number;
  /** "Terminal 1", "Terminal 2", … in the order they were opened in the project. */
  title: string;
  /** Set once the shell has ended; the terminal stays until it is closed. */
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
  | { type: "resize"; cols: number; rows: number }
  | { type: "exit"; code: number; signal?: number };

/**
 * The terminals of every project, shared by all pages: a terminal outlives the page that opened it, and stops with the
 * server. Stopping an agent does not touch them.
 */
export interface Terminals {
  readonly state: ReplicatedState<TerminalsState>;
  /** Start a shell in a project's directory. Returns the terminal's ID. */
  create(input: { workspaceId: number } & TerminalSize, context: Context): Promise<string>;
  /** End the shell, if it still runs, and take the terminal off the list. */
  close(id: string, context: Context): Promise<void>;
}

export const Terminals = defineService<Terminals>("tandem.terminals");

/** The WebSocket path of one terminal. */
export function terminalPath(id: string): string {
  return `/pty/${encodeURIComponent(id)}`;
}
