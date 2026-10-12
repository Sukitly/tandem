import { randomUUID } from "node:crypto";
import { type Context, type MutableReplicatedState, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  MAX_TERMINALS_PER_PROJECT,
  TERMINAL_START_SIZE,
  type TerminalSummary,
  type TerminalsState,
} from "@tandem/contracts";
import { HostedTerminal } from "../hosted-terminal.ts";
import { invalidInput } from "./errors.ts";
import type { ProjectPaths } from "./project-path.ts";
import type { WorkspaceCatalog } from "./workspaces.ts";

export interface TerminalHostOptions {
  /** The program a terminal runs, for tests; the user's login shell by default. */
  command?: readonly string[];
}

/**
 * The terminals of every project, in memory only: they stop with the server, and with their project. Stopping an
 * agent does not touch them.
 *
 * One host serves every project, and spawns shells on this machine directly, not through the project's execution
 * environment: that has no pseudo-terminals. Only the directory is resolved through it. A sandbox has to give each
 * project its own way to start a terminal.
 */
export class TerminalHost {
  readonly #paths: ProjectPaths;
  readonly #command: readonly string[] | undefined;
  readonly #terminals = new Map<string, HostedTerminal>();
  readonly #state: MutableReplicatedState<TerminalsState> = replicatedState<TerminalsState>({ terminals: [] });
  /** The number of the next terminal of each project, for its title. */
  readonly #opened = new Map<number, number>();
  readonly #stop: () => void;

  constructor(workspaces: WorkspaceCatalog, paths: ProjectPaths, options: TerminalHostOptions = {}) {
    this.#paths = paths;
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
  get(id: string): HostedTerminal | undefined {
    return this.#terminals.get(id);
  }

  async create(input: unknown, context: Context): Promise<string> {
    const { workspaceId } = (input ?? {}) as { workspaceId?: unknown };
    if (typeof workspaceId !== "number") throw invalidInput("workspaceId must be a number");
    // The directory as the project's environment resolves it; a directory that is gone is refused here, not reported
    // later as a shell that exited.
    const { target: cwd } = await this.#paths.resolve({ workspaceId, path: "" }, context);
    const open = this.#state.value.terminals.filter((summary) => summary.workspaceId === workspaceId).length;
    if (open >= MAX_TERMINALS_PER_PROJECT)
      throw invalidInput(`A project has at most ${MAX_TERMINALS_PER_PROJECT} terminals open`);

    // A program that cannot run ends at once with exit code 1; one that cannot even be forked throws, and goes to the
    // server's error report as any failure that is not the input's.
    const id = randomUUID();
    const terminal = new HostedTerminal({
      id,
      cwd,
      size: TERMINAL_START_SIZE,
      ...(this.#command === undefined ? {} : { command: this.#command }),
      onExit: (exit) => this.#change(id, (summary) => (summary.exit = exit)),
    });
    const number = this.#opened.get(workspaceId) ?? 1;
    this.#opened.set(workspaceId, number + 1);
    this.#terminals.set(id, terminal);
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.terminals.push({ id, workspaceId, title: `Terminal ${number}` });
    });
    return id;
  }

  close(id: unknown): void {
    if (typeof id !== "string" || !this.#terminals.has(id)) throw invalidInput(`Terminal ${String(id)} does not exist`);
    this.#close(id);
  }

  dispose(): void {
    this.#stop();
    for (const terminal of this.#terminals.values()) terminal.dispose();
    this.#terminals.clear();
  }

  #close(id: string): void {
    this.#terminals.get(id)?.dispose();
    this.#terminals.delete(id);
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.terminals = draft.terminals.filter((summary) => summary.id !== id);
    });
  }

  #change(id: string, change: (summary: TerminalSummary) => void): void {
    if (!this.#terminals.has(id)) return;
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      const summary = draft.terminals.find((candidate) => candidate.id === id);
      if (summary !== undefined) change(summary);
    });
  }
}
