import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { FileContent, FileEntry, Files } from "@tandem/contracts";
import { useSyncExternalStore } from "react";

/** Something read from the server: on its way, there, or refused with a reason. */
export type Loaded<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "failed"; message: string };

/** One object, so that selecting it twice gives the same value. */
const LOADING = { status: "loading" } as const;

/**
 * The file shown in the panel, and the line to show. Each request to show a place is a new object, so that showing the
 * same place again is a change that components can follow.
 */
export interface OpenedFile {
  path: string;
  line?: number;
  /** A comment thread asked for: shown where it is now, which `line` was when it was written. */
  threadId?: number;
}

/**
 * What the files panel shows of one project: listed directories, which ones are open, and the opened file with its
 * content. It outlives the panel, so a project's tree is as the user left it when they come back to it. Things are
 * read when first shown and on `refresh`; they do not follow changes on disk by themselves.
 */
export class ProjectFiles {
  readonly #files: Files;
  readonly #workspaceId: number;
  readonly #directories = new Map<string, Loaded<FileEntry[]>>();
  readonly #listRequests = new Map<string, symbol>();
  #readRequest = 0;
  #expanded = new Set<string>();
  #opened: OpenedFile | null = null;
  /** Of the opened file, or of the one opened before while the new one is read. */
  #content: { path: string; loaded: Loaded<FileContent> } | null = null;
  #failure: string | null = null;
  readonly #listeners = new Set<() => void>();

  constructor(files: Files, workspaceId: number) {
    this.#files = files;
    this.#workspaceId = workspaceId;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** A directory's entries; `""` is the project's directory. `undefined` until `load` asks for them. */
  directory(path: string): Loaded<FileEntry[]> | undefined {
    return this.#directories.get(path);
  }

  /** List a directory unless it is listed or being listed. A directory that failed is tried again. */
  load(path: string): void {
    const current = this.#directories.get(path);
    if (current !== undefined && current.status !== "failed") return;
    this.#list(path);
  }

  isExpanded(path: string): boolean {
    return this.#expanded.has(path);
  }

  setExpanded(path: string, expanded: boolean): void {
    if (this.#expanded.has(path) === expanded) return;
    this.#expanded = new Set(this.#expanded);
    if (expanded) this.#expanded.add(path);
    else this.#expanded.delete(path);
    this.#changed();
  }

  get opened(): OpenedFile | null {
    return this.#opened;
  }

  /** The opened file's content; `loading` while it is read for the first time. */
  get content(): Loaded<FileContent> | null {
    if (this.#opened === null) return null;
    return this.#content?.path === this.#opened.path ? this.#content.loaded : LOADING;
  }

  /** Show a file, at a line or a comment thread if one is given, with its directories open in the tree. */
  open(path: string, place: Omit<OpenedFile, "path"> = {}): void {
    const again = this.#opened?.path === path;
    this.#opened = { path, ...place };
    const directories = ancestors(path).filter((directory) => directory !== "");
    if (directories.some((directory) => !this.#expanded.has(directory))) {
      this.#expanded = new Set([...this.#expanded, ...directories]);
    }
    if (again && this.#content?.path === path && this.#content.loaded.status === "ready") this.#changed();
    else this.#read(path);
  }

  close(): void {
    this.#readRequest += 1;
    this.#opened = null;
    this.#content = null;
    this.#changed();
  }

  /** Why the last listing failed, until dismissed. */
  get failure(): string | null {
    return this.#failure;
  }

  dismissFailure(): void {
    this.#failure = null;
    this.#changed();
  }

  /**
   * Read again what is shown: the open directories and the opened file. What was shown stays until the new content
   * arrives; closed directories are listed again when they next open.
   */
  refresh(): void {
    this.#failure = null;
    for (const path of [...this.#directories.keys()]) {
      if (path === "" || this.#expanded.has(path)) this.#list(path);
      else {
        this.#directories.delete(path);
        this.#listRequests.delete(path);
      }
    }
    if (this.#opened !== null) this.#read(this.#opened.path);
    this.#changed();
  }

  #list(path: string): void {
    const request = Symbol();
    this.#listRequests.set(path, request);
    if (this.#directories.get(path)?.status !== "ready") this.#directories.set(path, LOADING);
    this.#changed();
    this.#files.list({ workspaceId: this.#workspaceId, path }, BACKGROUND_CONTEXT).then(
      (entries) => {
        if (this.#listRequests.get(path) !== request) return;
        this.#listRequests.delete(path);
        this.#directories.set(path, { status: "ready", value: entries });
        this.#changed();
      },
      (error: unknown) => {
        if (this.#listRequests.get(path) !== request) return;
        this.#listRequests.delete(path);
        this.#directories.set(path, { status: "failed", message: messageOf(error) });
        this.#failure = messageOf(error);
        this.#changed();
      },
    );
  }

  /** The content shown so far stays until the new one arrives. */
  #read(path: string): void {
    const request = ++this.#readRequest;
    this.#changed();
    this.#files.read({ workspaceId: this.#workspaceId, path }, BACKGROUND_CONTEXT).then(
      (content) => this.#settle(path, request, { status: "ready", value: content }),
      (error: unknown) => this.#settle(path, request, { status: "failed", message: messageOf(error) }),
    );
  }

  /** Only the latest request may update the opened file, even after closing and reopening the same path. */
  #settle(path: string, request: number, loaded: Loaded<FileContent>): void {
    if (this.#opened?.path !== path || request !== this.#readRequest) return;
    this.#content = { path, loaded };
    this.#changed();
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}

/**
 * What a component shows of the project's files; it renders again only when that changes. The selection must return
 * the same value while nothing it reads changed: a primitive, or an object the store keeps.
 */
export function useProjectFiles<T>(files: ProjectFiles, select: (files: ProjectFiles) => T): T {
  return useSyncExternalStore(files.subscribe, () => select(files));
}

/** The directories a path is in, from the project's directory down: `a/b/c.ts` is in `""`, `a`, and `a/b`. */
export function ancestors(path: string): string[] {
  const segments = path.split("/").slice(0, -1);
  return ["", ...segments.map((_, index) => segments.slice(0, index + 1).join("/"))];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
