import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { type Context, copyJson, type MutableReplicatedState, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import type { WorkspaceSummary, WorkspacesState } from "@tandem/contracts";
import { invalidInput } from "./errors.ts";

/** A removed workspace is kept, so that adding its directory again brings back its conversations. */
type StoredWorkspace = { id: number; path: string; removed?: true };

const WorkspacesDoc = defineDoc<{ nextId: number; workspaces: StoredWorkspace[] }>({
  kind: "tandem.workspaces",
  version: 1,
  scope: "session",
  initial: () => ({ nextId: 1, workspaces: [] }),
});

/** The projects, stored in the Harness's database. It is the only writer of the document. */
export class WorkspaceCatalog {
  readonly #harness: Harness;
  readonly #state: MutableReplicatedState<WorkspacesState>;
  readonly #listeners = new Set<() => void>();
  #stored: readonly StoredWorkspace[];

  private constructor(harness: Harness, stored: readonly StoredWorkspace[]) {
    this.#harness = harness;
    this.#stored = stored;
    this.#state = replicatedState<WorkspacesState>({ workspaces: listed(stored) });
  }

  static async load(harness: Harness, context: Context): Promise<WorkspaceCatalog> {
    const doc = await harness.snapshot(WorkspacesDoc, context);
    return new WorkspaceCatalog(harness, doc?.workspaces ?? []);
  }

  get state(): MutableReplicatedState<WorkspacesState> {
    return this.#state;
  }

  /** A listed workspace. */
  get(id: number): WorkspaceSummary | undefined {
    return this.#state.value.workspaces.find((workspace) => workspace.id === id);
  }

  isListed(id: number): boolean {
    return this.get(id) !== undefined;
  }

  /** Called after the list changes. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async add(pathInput: string, context: Context): Promise<number> {
    const path = await directory(pathInput);
    return this.#update(context, (doc) => {
      const existing = doc.workspaces.find((workspace) => workspace.path === path);
      if (existing === undefined) return insert(doc, path);
      delete existing.removed;
      return existing.id;
    });
  }

  async remove(id: number, context: Context): Promise<void> {
    if (!this.isListed(id)) throw invalidInput(`Project ${id} does not exist`);
    await this.#update(context, (doc) => {
      const workspace = doc.workspaces.find((candidate) => candidate.id === id);
      if (workspace !== undefined) workspace.removed = true;
    });
  }

  /**
   * The workspace of a directory, added if there is none. Conversations created before workspaces existed are given
   * theirs this way; a removed workspace stays removed.
   */
  async forPath(path: string, context: Context): Promise<number> {
    const existing = this.#stored.find((workspace) => workspace.path === path);
    if (existing !== undefined) return existing.id;
    return this.#update(context, (doc) => insert(doc, path));
  }

  async #update<R>(
    context: Context,
    change: (doc: { nextId: number; workspaces: StoredWorkspace[] }) => R,
  ): Promise<R> {
    const { result, stored } = await this.#harness.commit(async (tx) => {
      const doc = await tx.doc(WorkspacesDoc);
      const result = change(doc);
      return { result, stored: copyJson(doc.workspaces) as StoredWorkspace[] };
    }, context);
    this.#stored = stored;
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.workspaces = listed(stored);
    });
    for (const listener of this.#listeners) listener();
    return result;
  }
}

function insert(doc: { nextId: number; workspaces: StoredWorkspace[] }, path: string): number {
  const id = doc.nextId++;
  doc.workspaces.push({ id, path });
  return id;
}

function listed(stored: readonly StoredWorkspace[]): WorkspaceSummary[] {
  return stored
    .filter((workspace) => workspace.removed !== true)
    .map(({ id, path }) => ({ id, path, name: basename(path) || path }));
}

/** An existing directory's absolute path, with `~` expanded. */
async function directory(input: string): Promise<string> {
  if (typeof input !== "string" || input.trim() === "") throw invalidInput("Enter the directory's path");
  const trimmed = input.trim();
  const expanded = trimmed === "~" || trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(1)) : trimmed;
  if (!isAbsolute(expanded)) throw invalidInput("The path must be absolute, or start with ~");
  const path = resolve(expanded);
  const stats = await stat(path).catch(() => undefined);
  if (stats?.isDirectory() !== true) throw invalidInput(`Not a directory: ${path}`);
  return path;
}
