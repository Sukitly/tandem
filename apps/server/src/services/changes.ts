import { isAbsolute, join } from "node:path";
import { type Context, type MutableReplicatedState, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ExecutionEnv, FileWatcher, WatchChange } from "@earendil-works/pi-durable/env";
import {
  type ChangedFile,
  type ChangeStatus,
  type ChangesState,
  type FilePatch,
  MAX_CHANGED_FILES,
  MAX_PATCH_BYTES,
  MAX_UNTRACKED_BYTES,
  MAX_UNTRACKED_FILES,
  type ProjectChanges,
} from "@tandem/contracts";
import type { ProjectPaths } from "./project-path.ts";

const GIT_TIMEOUT_MS = 10_000;

/** How long changes settle before the list is read again. */
const REFRESH_DELAY_MS = 300;

/** Probed in order when the remote's default branch is not configured locally. */
const BASE_REFS = ["origin/main", "origin/master", "main", "master"];

/** Git output kept for one command; what follows is dropped and makes the result incomplete. */
const MAX_OUTPUT_BYTES = MAX_PATCH_BYTES * 2;

/**
 * Names never watched: the repository's own bookkeeping, and installed packages. Hidden paths are watched like any
 * other, because the list holds hidden files too.
 */
const UNWATCHED = [".git", "node_modules"];

/**
 * One project's changes against its integration branch, watched while a client holds the project open. The base is the
 * merge base with that branch, so branch commits, staged and unstaged work, and untracked files are one list; a project
 * without an integration branch is compared with its last commit.
 */
export class ProjectChangeTracker {
  readonly state: MutableReplicatedState<ChangesState>;
  readonly #paths: Pick<ProjectPaths, "resolve">;
  readonly #env: ExecutionEnv;
  readonly #workspaceId: number;
  /** Where Git runs: the project's directory. */
  readonly #root: string;
  readonly #onError: (error: Error) => void;
  #base = "HEAD";
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
    this.#env = env;
    this.#paths = paths;
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
    if (entry !== undefined && entry.additions === undefined && entry.status !== "deleted") return { kind: "binary" };
    const untracked = entry?.status === "untracked";
    const run = await git(
      this.#env,
      this.#root,
      untracked
        ? ["diff", "--no-index", "--no-color", "--", "/dev/null", path]
        : ["diff", "--relative", "--no-color", this.#base, "--", path],
      context,
    );
    // A path the client may not ask about rejects; Git failing to read a file it could read a moment ago is an outcome
    // the panel shows, not an error the client made.
    if (run === undefined) return { kind: "unavailable", message: "Cannot run Git" };
    // `--no-index` answers 1 when the files differ, which for an untracked file is every case.
    if (run.code !== 0 && !(untracked && run.code === 1)) {
      return { kind: "unavailable", message: run.stderr.trim() === "" ? "Cannot read the diff" : run.stderr.trim() };
    }
    if (run.truncated) return { kind: "tooLarge" };
    return { kind: "patch", patch: run.stdout };
  }

  /**
   * Read the list again, and watch again if watching had stopped. A failure is published in the state rather than
   * thrown, so that a client that reads again to catch up need not handle one.
   */
  async refresh(context: Context): Promise<void> {
    try {
      await this.#read(context);
    } catch (error) {
      this.#unavailable("error", error instanceof Error ? error.message : String(error));
    }
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
    const repository = await git(this.#env, this.#root, ["rev-parse", "--git-dir"], context);
    if (repository === undefined) {
      this.#unavailable("error", "Cannot run Git. Is it installed and on the PATH?");
      return;
    }
    if (repository.code !== 0) {
      this.#unavailable("notRepository", "This directory is not in a Git repository.");
      return;
    }
    const baseRef = await this.#resolveBaseRef(context);
    this.#base = baseRef === undefined ? "HEAD" : await mergeBase(this.#env, this.#root, baseRef, context);
    const tracked = await this.#trackedFiles(context);
    if (tracked === undefined) {
      this.#unavailable("error", "Cannot read this repository's changes.");
      return;
    }
    const untracked = await this.#untrackedFiles(context);
    // A listing that could not run at all would drop those files from the list; the next read tries again.
    if (untracked === undefined) return;
    const files = [...tracked, ...untracked].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    const listed = files.slice(0, MAX_CHANGED_FILES);
    this.#publish({
      status: "ready",
      base: baseRef ?? "HEAD",
      files: listed,
      message:
        files.length > listed.length ? `Only the first ${MAX_CHANGED_FILES} changed files are listed.` : undefined,
    });
  }

  /** The commit the list is measured from, named for the panel: the integration branch when there is one. */
  async #resolveBaseRef(context: Context): Promise<string | undefined> {
    const advertised = await git(
      this.#env,
      this.#root,
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      context,
    );
    if (advertised !== undefined && advertised.code === 0 && advertised.stdout.trim() !== "") {
      return advertised.stdout.trim();
    }
    for (const ref of BASE_REFS) {
      const found = await git(this.#env, this.#root, ["rev-parse", "--verify", "--quiet", ref], context);
      if (found !== undefined && found.code === 0) return ref;
    }
    return undefined;
  }

  /** The changed tracked files, or `undefined` when Git cannot say. */
  async #trackedFiles(context: Context): Promise<ChangedFile[] | undefined> {
    const [names, numbers] = await Promise.all([
      this.#diff("--name-status", context),
      this.#diff("--numstat", context),
    ]);
    if (names === undefined || numbers === undefined) return undefined;
    const counts = parseNumstat(numbers);
    return parseNameStatus(names).map((entry) => {
      const count = counts.get(entry.path) ?? {};
      return withoutEmpty({
        path: entry.path,
        status: entry.status,
        from: entry.from,
        additions: count.additions,
        deletions: count.deletions,
      });
    });
  }

  /** A `git diff` against the base, or against the index in a repository without a commit yet. */
  async #diff(summary: string, context: Context): Promise<string | undefined> {
    const base = await git(this.#env, this.#root, ["diff", "--relative", summary, "-z", this.#base, "--"], context);
    if (base !== undefined && base.code === 0) return base.stdout;
    const index = await git(this.#env, this.#root, ["diff", "--relative", summary, "-z", "--cached", "--"], context);
    return index !== undefined && index.code === 0 ? index.stdout : undefined;
  }

  /** Every untracked file, with the lines it would add; Git's ignore rules leave theirs out. */
  async #untrackedFiles(context: Context): Promise<ChangedFile[] | undefined> {
    const listed = await git(this.#env, this.#root, ["ls-files", "--others", "--exclude-standard", "-z"], context);
    if (listed === undefined) return undefined;
    if (listed.code !== 0) return [];
    const files = listed.stdout.split("\0").filter((path) => path !== "");
    return Promise.all(
      files.slice(0, MAX_UNTRACKED_FILES).map(async (path): Promise<ChangedFile> => {
        const additions = await addedLines(this.#env, `${this.#root}/${path}`, context);
        return withoutEmpty({ path, status: "untracked" as const, additions });
      }),
    );
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

  #unavailable(status: "notRepository" | "error", message: string): void {
    this.#publish({ status, files: [], message });
  }

  /** Say something about a list that stays as it is. */
  #note(message: string): void {
    const current = this.state.value;
    this.#publish({ ...current, message });
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

/** An absent value is left out: a replicated state holds JSON, which has no `undefined`. */
function withoutEmpty<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function setOrDrop<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
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

interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
  /** The command wrote more than was kept. */
  truncated: boolean;
}

/** Run Git in a directory. `undefined` when the command could not be run at all, for example without Git installed. */
async function git(
  env: ExecutionEnv,
  cwd: string,
  args: readonly string[],
  context: Context,
): Promise<GitRun | undefined> {
  let stdout = "";
  let stderr = "";
  let truncated = false;
  const result = await env.exec(
    ["git", ...args],
    {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      onOutput: (text, _context, info) => {
        if (info.stream === "stdout") {
          stdout += text;
          if (stdout.length > MAX_OUTPUT_BYTES) {
            stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
            truncated = true;
          }
        } else if (stderr.length < MAX_OUTPUT_BYTES) {
          stderr += text;
        }
      },
    },
    context,
  );
  if (!result.ok) return undefined;
  return { code: result.value.exitCode, stdout, stderr, truncated };
}

/**
 * The commit the changes are measured from: the merge base with the integration branch, advanced over the heads of an
 * in-progress merge. `HEAD` stays at the pre-merge tip until that merge is committed, while the working tree already
 * holds the merged work, which must not count as local additions. `HEAD` when there is no common ancestor.
 */
async function mergeBase(env: ExecutionEnv, cwd: string, baseRef: string, context: Context): Promise<string> {
  const base = await git(env, cwd, ["merge-base", baseRef, "HEAD"], context);
  const value = base?.stdout.trim() ?? "";
  if (base === undefined || base.code !== 0 || value === "") return "HEAD";
  let advanced = value;
  for (const head of await mergedHeads(env, cwd, context)) {
    const candidate = await git(env, cwd, ["merge-base", baseRef, head], context);
    const commit = candidate?.stdout.trim() ?? "";
    // Incomparable candidates have no single newest base: keep the one in hand.
    if (candidate === undefined || candidate.code !== 0 || commit === "" || commit === advanced) continue;
    const ancestor = await git(env, cwd, ["merge-base", "--is-ancestor", advanced, commit], context);
    if (ancestor !== undefined && ancestor.code === 0) advanced = commit;
  }
  return advanced;
}

/** Every head of an in-progress merge, including octopus merges and worktrees. */
async function mergedHeads(env: ExecutionEnv, cwd: string, context: Context): Promise<string[]> {
  const path = await git(env, cwd, ["rev-parse", "--git-path", "MERGE_HEAD"], context);
  const file = path?.stdout.trim() ?? "";
  if (path === undefined || path.code !== 0 || file === "") return [];
  const text = await env.readTextFile(isAbsolute(file) ? file : join(cwd, file), context);
  if (!text.ok) return [];
  return text.value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** `git diff --name-status -z`: a status, then the path; a rename or copy adds the path it came from. */
function parseNameStatus(output: string): { path: string; status: ChangeStatus; from?: string }[] {
  const parts = output.split("\0");
  const entries: { path: string; status: ChangeStatus; from?: string }[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const code = parts[index];
    if (code === undefined || code === "") continue;
    const letter = code[0] ?? "M";
    if (letter === "R" || letter === "C") {
      const from = parts[index + 1];
      const path = parts[index + 2];
      index += 2;
      if (from === undefined || path === undefined) break;
      entries.push({ path, status: letter === "R" ? "renamed" : "copied", from });
      continue;
    }
    const path = parts[index + 1];
    index += 1;
    if (path === undefined) break;
    entries.push({ path, status: statusOf(letter) });
  }
  return entries;
}

function statusOf(letter: string): ChangeStatus {
  switch (letter) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "T":
      return "typeChanged";
    case "U":
      return "conflicted";
    default:
      return "modified";
  }
}

/** `git diff --numstat -z`: added and deleted lines per path; a binary file reports `-`. */
function parseNumstat(output: string): Map<string, { additions?: number; deletions?: number }> {
  const parts = output.split("\0");
  const counts = new Map<string, { additions?: number; deletions?: number }>();
  let index = 0;
  while (index < parts.length) {
    const record = parts[index];
    index += 1;
    if (record === undefined || record === "") continue;
    const [added, deleted, inline] = record.split("\t");
    let path = inline;
    // A rename leaves the path out and gives the path it came from, then the path it became.
    if (path === undefined || path === "") {
      index += 1;
      path = parts[index];
      index += 1;
    }
    if (path === undefined || path === "") continue;
    counts.set(path, {
      additions: added === "-" ? undefined : Number(added),
      deletions: deleted === "-" ? undefined : Number(deleted),
    });
  }
  return counts;
}

/** The lines an untracked file would add, or `undefined` for one too large or not text. */
async function addedLines(env: ExecutionEnv, path: string, context: Context): Promise<number | undefined> {
  const opened = await env.openBinaryReader(path, undefined, context);
  if (!opened.ok) return undefined;
  const reader = opened.value;
  try {
    const info = await reader.info(context);
    if (!info.ok || info.value.size > MAX_UNTRACKED_BYTES) return undefined;
    const bytes = await reader.read(0, info.value.size, context);
    if (!bytes.ok || bytes.value.includes(0)) return undefined;
    let lines = 0;
    for (const byte of bytes.value) if (byte === 0x0a) lines += 1;
    return bytes.value.length > 0 && bytes.value[bytes.value.length - 1] !== 0x0a ? lines + 1 : lines;
  } finally {
    await reader.close(context);
  }
}
