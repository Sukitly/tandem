import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { FileContent, FileEntry, Files } from "@tandem/contracts";
import type { QueryClient, QueryKey, QueryState } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { createStore } from "zustand/vanilla";
import { createQueryClient, serviceKey } from "@/app/query-client.tsx";
import { errorMessage } from "@/lib/errors.ts";

export type Loaded<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "failed"; message: string };
const LOADING = { status: "loading" } as const;
export interface OpenedFile {
  path: string;
  line?: number;
  threadId?: number;
}

/** UI intent lives in Zustand; directory and file snapshots live exclusively in TanStack Query. */
export class ProjectFiles {
  readonly #files: Files;
  readonly #client: QueryClient;
  readonly #workspaceId: number;
  readonly #prefix: readonly [string, number, number];
  readonly #directories = new Set<string>();
  readonly #views = new WeakMap<object, Loaded<unknown>>();
  readonly #ui = createStore<{
    opened: OpenedFile | null;
    expanded: ReadonlySet<string>;
    dismissed: ReadonlySet<unknown>;
  }>()(() => ({ opened: null, expanded: new Set(), dismissed: new Set() }));

  constructor(files: Files, workspaceId: number, client = createQueryClient()) {
    this.#files = files;
    this.#client = client;
    this.#workspaceId = workspaceId;
    this.#prefix = ["project-files", serviceKey(files), workspaceId];
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    const stopUI = this.#ui.subscribe(listener);
    const stopCache = this.#client.getQueryCache().subscribe(({ query }) => {
      if (this.#prefix.every((part, index) => query.queryKey[index] === part)) listener();
    });
    return () => {
      stopUI();
      stopCache();
    };
  };

  #key(kind: "directory" | "file", path: string): QueryKey {
    return [...this.#prefix, kind, path];
  }
  #loaded<T>(state: QueryState<T> | undefined): Loaded<T> | undefined {
    if (state === undefined) return undefined;
    const cached = this.#views.get(state);
    if (cached !== undefined) return cached as Loaded<T>;
    const loaded: Loaded<T> =
      state.status === "error"
        ? { status: "failed", message: errorMessage(state.error) }
        : state.data !== undefined
          ? { status: "ready", value: state.data }
          : LOADING;
    this.#views.set(state, loaded);
    return loaded;
  }
  directory(path: string): Loaded<FileEntry[]> | undefined {
    return this.#loaded(this.#client.getQueryState<FileEntry[]>(this.#key("directory", path)));
  }
  load(path: string): void {
    this.#directories.add(path);
    const current = this.directory(path);
    if (current !== undefined && current.status !== "failed") return;
    this.#list(path);
  }
  isExpanded(path: string): boolean {
    return this.#ui.getState().expanded.has(path);
  }
  setExpanded(path: string, expanded: boolean): void {
    const next = new Set(this.#ui.getState().expanded);
    if (expanded) next.add(path);
    else next.delete(path);
    this.#ui.setState({ expanded: next });
  }
  get opened(): OpenedFile | null {
    return this.#ui.getState().opened;
  }
  get content(): Loaded<FileContent> | null {
    const opened = this.opened;
    if (opened === null) return null;
    return this.#loaded(this.#client.getQueryState<FileContent>(this.#key("file", opened.path))) ?? LOADING;
  }
  open(path: string, place: Omit<OpenedFile, "path"> = {}): void {
    const again = this.opened?.path === path;
    this.#ui.setState((state) => ({
      opened: { path, ...place },
      expanded: new Set([...state.expanded, ...ancestors(path).filter(Boolean)]),
    }));
    if (!again || this.content?.status !== "ready") this.#read(path);
  }
  close(): void {
    const path = this.opened?.path;
    this.#ui.setState({ opened: null });
    if (path !== undefined) this.#client.removeQueries({ queryKey: this.#key("file", path), exact: true });
  }
  get failure(): string | null {
    const dismissed = this.#ui.getState().dismissed;
    for (const path of this.#directories) {
      const state = this.#client.getQueryState(this.#key("directory", path));
      if (state?.status === "error" && !dismissed.has(state.error)) return errorMessage(state.error);
    }
    return null;
  }
  dismissFailure(): void {
    this.#ui.setState({
      dismissed: new Set(
        [...this.#directories].map((path) => this.#client.getQueryState(this.#key("directory", path))?.error),
      ),
    });
  }
  refresh(): void {
    for (const path of this.#directories) {
      if (path === "" || this.isExpanded(path)) this.#list(path);
      else this.#client.removeQueries({ queryKey: this.#key("directory", path), exact: true });
    }
    if (this.opened !== null) this.#read(this.opened.path);
  }
  #list(path: string): void {
    const queryKey = this.#key("directory", path);
    void this.#client.cancelQueries({ queryKey, exact: true });
    void this.#client
      .fetchQuery({
        queryKey,
        staleTime: 0,
        queryFn: () => this.#files.list({ workspaceId: this.#workspaceId, path }, BACKGROUND_CONTEXT),
      })
      .catch(() => {});
  }
  #read(path: string): void {
    const queryKey = this.#key("file", path);
    void this.#client.cancelQueries({ queryKey, exact: true });
    void this.#client
      .fetchQuery({
        queryKey,
        staleTime: 0,
        queryFn: () => this.#files.read({ workspaceId: this.#workspaceId, path }, BACKGROUND_CONTEXT),
      })
      .catch(() => {});
  }
  dispose(): void {
    this.close();
    this.#client.removeQueries({ queryKey: this.#prefix });
    this.#directories.clear();
  }
}

export function useProjectFiles<T>(files: ProjectFiles, select: (files: ProjectFiles) => T): T {
  return useSyncExternalStore(files.subscribe, () => select(files));
}
export function ancestors(path: string): string[] {
  const segments = path.split("/").slice(0, -1);
  return ["", ...segments.map((_, index) => segments.slice(0, index + 1).join("/"))];
}
