import { type MutableReplicatedState, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  MAX_TERMINALS_PER_PROJECT,
  type TerminalSize,
  type TerminalSummary,
  type TerminalsState,
} from "@tandem/contracts";
import { Pty } from "../pty.ts";
import { invalidInput } from "./errors.ts";
import type { WorkspaceCatalog } from "./workspaces.ts";

export interface TerminalHostOptions {
  /** The program a terminal runs, for tests; the user's login shell by default. */
  command?: readonly string[];
}

/**
 * The terminals of every project, in memory only: they stop with the server. A terminal of a project that is removed
 * is closed; stopping an agent does not touch them.
 */
export class TerminalHost {
  readonly #workspaces: WorkspaceCatalog;
  readonly #command: readonly string[] | undefined;
  readonly #ptys = new Map<string, Pty>();
  readonly #state: MutableReplicatedState<TerminalsState> = replicatedState<TerminalsState>({ terminals: [] });
  /** The number of the next terminal of each project, for its title. */
  readonly #opened = new Map<number, number>();
  readonly #stop: () => void;

  constructor(workspaces: WorkspaceCatalog, options: TerminalHostOptions = {}) {
    this.#workspaces = workspaces;
    this.#command = options.command;
    this.#stop = workspaces.subscribe(() => {
      for (const summary of this.#state.value.terminals)
        if (!workspaces.isListed(summary.workspaceId)) this.#close(summary.id);
    });
  }

  get state(): MutableReplicatedState<TerminalsState> {
    return this.#state;
  }

  /** The terminal a `/pty/<id>` connection is for. */
  get(id: string): Pty | undefined {
    return this.#ptys.get(id);
  }

  create(input: unknown): string {
    const { workspaceId, cols, rows } = (input ?? {}) as { workspaceId?: unknown; cols?: unknown; rows?: unknown };
    if (typeof workspaceId !== "number") throw invalidInput("workspaceId must be a number");
    const workspace = this.#workspaces.get(workspaceId);
    if (workspace === undefined) throw invalidInput(`Project ${workspaceId} does not exist`);
    if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows))
      throw invalidInput("cols and rows must be integers");
    const open = this.#state.value.terminals.filter((summary) => summary.workspaceId === workspaceId).length;
    if (open >= MAX_TERMINALS_PER_PROJECT)
      throw invalidInput(`A project has at most ${MAX_TERMINALS_PER_PROJECT} terminals open`);

    let pty: Pty;
    try {
      pty = new Pty({
        cwd: workspace.path,
        size: { cols, rows } as TerminalSize,
        ...(this.#command === undefined ? {} : { command: this.#command }),
        onExit: (exit) => this.#change(pty.id, (summary) => (summary.exit = exit)),
      });
    } catch (error) {
      throw invalidInput(`Cannot start a shell: ${error instanceof Error ? error.message : String(error)}`);
    }
    const number = this.#opened.get(workspaceId) ?? 1;
    this.#opened.set(workspaceId, number + 1);
    this.#ptys.set(pty.id, pty);
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.terminals.push({ id: pty.id, workspaceId, title: `Terminal ${number}` });
    });
    return pty.id;
  }

  close(id: unknown): void {
    if (typeof id !== "string" || !this.#ptys.has(id)) throw invalidInput(`Terminal ${String(id)} does not exist`);
    this.#close(id);
  }

  dispose(): void {
    this.#stop();
    for (const pty of this.#ptys.values()) pty.dispose();
    this.#ptys.clear();
  }

  #close(id: string): void {
    this.#ptys.get(id)?.dispose();
    this.#ptys.delete(id);
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.terminals = draft.terminals.filter((summary) => summary.id !== id);
    });
  }

  #change(id: string, change: (summary: TerminalSummary) => void): void {
    if (!this.#ptys.has(id)) return;
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      const summary = draft.terminals.find((candidate) => candidate.id === id);
      if (summary !== undefined) change(summary);
    });
  }
}
