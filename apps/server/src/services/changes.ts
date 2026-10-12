import { type Context, type MutableReplicatedState, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ExecutionEnv, FileWatcher, WatchChange } from "@earendil-works/pi-durable/env";
import type { ChangesState, FilePatch, ProjectChanges } from "@tandem/contracts";
import { ChangeReader } from "./changes-git.ts";
import type { ProjectPaths } from "./project-path.ts";

/** How long changes settle before the list is read again. */
const REFRESH_DELAY_MS = 300;

/**
 * Names never watched: the repository's own bookkeeping, and installed packages. Hidden paths are watched like any
 * other, because the list holds hidden files too.
 */
const UNWATCHED = [".git", "node_modules"];

/**
 * One project's changes, watched while a client holds the project open: what to read, and when, around the reads
 * themselves (`changes-git.ts`). The base is the merge base with the project's integration branch, so branch commits,
 * staged and unstaged work, and untracked files are one list.
 */
export class ProjectChangeTracker {
  readonly state: MutableReplicatedState<ChangesState>;
  readonly #paths: Pick<ProjectPaths, "resolve">;
  readonly #reader: ChangeReader;
  /** The environment whose file changes are watched; the reader asks it about Git. */
  readonly #env: ExecutionEnv;
  readonly #workspaceId: number;
  /** Where Git runs: the project's directory. */
  readonly #root: string;
  readonly #onError: (error: Error) => void;
  #watcher: FileWatcher | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  private constructor(
    workspaceId: number,
    root: string,
    env: ExecutionEnv,
    paths: Pick<ProjectPaths, "resolve">,
    onError: (error: Error) => void,
  ) {
    this.#onError = onError;
    this.#workspaceId = workspaceId;
    this.#root = root;
    this.#paths = paths;
    this.#env = env;
    this.#reader = new ChangeReader(env, root);
    this.state = replicatedState<ChangesState>({ workspaceId, status: "ready", files: [] });
  }

  /**
   * Read the changes once, then follow them. Errors of the later reads, ones no client asked for, go to `onError`: the
   * state carries what Git says, not what the server itself failed at.
   */
  static async open(
    workspaceId: number,
    paths: Pick<ProjectPaths, "resolve">,
    context: Context,
    onError: (error: Error) => void = () => {},
  ): Promise<ProjectChangeTracker> {
    const { env, target } = await paths.resolve({ workspaceId, path: "" }, context);
    const tracker = new ProjectChangeTracker(workspaceId, target, env, paths, onError);
    // The tracker outlives the call that started it, so its reads run under its own context: one belongs to the call,
    // which Chord aborts when the call is done, and a read under an aborted context fails without saying so.
    await tracker.refresh(BACKGROUND_CONTEXT);
    return tracker;
  }

  async diff(pathInput: string, context: Context): Promise<FilePatch> {
    const { path } = await this.#paths.resolve({ workspaceId: this.#workspaceId, path: pathInput }, context);
    const entry = this.state.value.files.find((file) => file.path === path);
    return this.#reader.diff(
      path,
      {
        untracked: entry?.status === "untracked",
        // A file the list does not hold is read as a patch: only Git can say whether it differs.
        binary: entry !== undefined && entry.additions === undefined && entry.status !== "deleted",
      },
      context,
    );
  }

  /**
   * Read the list again, and watch again if watching had stopped. A failure is published in the state rather than
   * thrown, so that a client that reads again to catch up need not handle one.
   */
  async refresh(context: Context): Promise<void> {
    // The user asked, so what a read cannot change is asked again too: a repository created, or given a remote, since
    // the last read is found this way.
    this.#reader.forget();
    await this.#read(context);
    await this.#watch();
  }

  /** Stop watching. The state stays as it is; no later read follows. */
  dispose(): void {
    this.#closed = true;
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    const watcher = this.#watcher;
    this.#watcher = undefined;
    watcher?.close(BACKGROUND_CONTEXT).catch(() => {});
  }

  async #read(context: Context): Promise<void> {
    try {
      const read = await this.#reader.read(context);
      if (read.status === "unreadable") return;
      if (read.status === "ready") {
        this.#publish({ status: "ready", base: read.base, files: read.files, message: read.message });
        return;
      }
      this.#publish({ status: read.status, files: [], message: read.message });
    } catch (error) {
      this.#publish({ status: "error", files: [], message: messageOf(error) });
    }
  }

  async #watch(): Promise<void> {
    if (this.#closed || this.#watcher !== undefined || this.state.value.status !== "ready") return;
    const result = await this.#env.watch(
      [{ path: this.#root, recursive: true, exclude: { names: UNWATCHED } }],
      (change) => this.#changed(change),
      BACKGROUND_CONTEXT,
    );
    if (!result.ok) {
      this.#note(`Not watching for changes: ${result.error.message}`);
      return;
    }
    if (this.#closed) {
      result.value.close(BACKGROUND_CONTEXT).catch(() => {});
      return;
    }
    this.#watcher = result.value;
  }

  #changed(change: WatchChange): void {
    if (this.#closed) return;
    if ("error" in change) {
      const watcher = this.#watcher;
      this.#watcher = undefined;
      watcher?.close(BACKGROUND_CONTEXT).catch(() => {});
      this.#note(`Not watching for changes: ${change.error.message}`);
      return;
    }
    // Coverage was uncertain for a while: read everything again, including what a read cannot change.
    if ("overflow" in change) this.#reader.forget();
    this.#schedule();
  }

  /** Read again once the changes have settled; further changes wait for that read. */
  #schedule(): void {
    if (this.#closed || this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#read(BACKGROUND_CONTEXT).catch((error: unknown) => {
        this.#onError(error instanceof Error ? error : new Error(String(error)));
      });
    }, REFRESH_DELAY_MS);
  }

  /** Say something about a list that stays as it is. */
  #note(message: string): void {
    this.#publish({ ...this.state.value, message });
  }

  #publish(next: Omit<ChangesState, "workspaceId">): void {
    this.state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.status = next.status;
      draft.files = next.files;
      setOrDrop(draft, "base", next.base);
      setOrDrop(draft, "message", next.message);
    });
  }
}

/** One client's hold on a project's changes. */
export interface ChangeHold {
  readonly tracker: ProjectChangeTracker;
  /** Give the hold up. Releasing one twice does nothing, so a late release cannot end another's. */
  release(): Promise<void>;
}

/**
 * The trackers of the projects, one per project however many clients watch it: a second tab, or a second person, adds
 * to the count instead of starting another watcher and another set of Git reads. The last hold to be given up ends the
 * tracker. Holds are counted rather than named, and a hold is given up once, because the open that took it and the
 * close that gives it up arrive in either order.
 */
export class ChangeTrackers {
  readonly #paths: Pick<ProjectPaths, "resolve">;
  readonly #onError: (error: Error) => void;
  readonly #trackers = new Map<number, { tracker: Promise<ProjectChangeTracker>; holds: number }>();

  constructor(paths: Pick<ProjectPaths, "resolve">, onError: (error: Error) => void = () => {}) {
    this.#paths = paths;
    this.#onError = onError;
  }

  /** Watch a project, starting its tracker if it is not watched yet. */
  async acquire(workspaceId: number, context: Context): Promise<ChangeHold> {
    let entry = this.#trackers.get(workspaceId);
    if (entry === undefined) {
      const tracker = ProjectChangeTracker.open(workspaceId, this.#paths, context, this.#onError);
      entry = { tracker, holds: 0 };
      this.#trackers.set(workspaceId, entry);
      tracker.catch(() => {
        if (this.#trackers.get(workspaceId) === entry) this.#trackers.delete(workspaceId);
      });
    }
    entry.holds += 1;
    const holding = entry;
    const tracker = await holding.tracker;
    let released = false;
    return {
      tracker,
      release: async () => {
        if (released) return;
        released = true;
        await this.#release(workspaceId, holding);
      },
    };
  }

  /** End every tracker; for the server's shutdown. */
  async dispose(): Promise<void> {
    const trackers = [...this.#trackers.values()];
    this.#trackers.clear();
    for (const entry of trackers) (await entry.tracker.catch(() => undefined))?.dispose();
  }

  async #release(workspaceId: number, entry: { tracker: Promise<ProjectChangeTracker>; holds: number }): Promise<void> {
    entry.holds -= 1;
    if (entry.holds > 0) return;
    if (this.#trackers.get(workspaceId) === entry) this.#trackers.delete(workspaceId);
    const tracker = await entry.tracker.catch(() => undefined);
    tracker?.dispose();
  }
}

/** The `ProjectChanges` instance one connection receives for one open project. */
export function createProjectChanges(tracker: ProjectChangeTracker): ProjectChanges {
  return {
    state: tracker.state,
    diff: (path, context) => tracker.diff(path, context),
    refresh: (context) => tracker.refresh(context),
  };
}

function setOrDrop<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
