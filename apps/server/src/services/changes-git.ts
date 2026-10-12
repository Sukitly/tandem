import { isAbsolute, join } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import {
  type ChangedFile,
  type ChangeStatus,
  type FilePatch,
  MAX_CHANGED_FILES,
  MAX_PATCH_BYTES,
  MAX_UNTRACKED_BYTES,
  MAX_UNTRACKED_FILES,
} from "@tandem/contracts";

const GIT_TIMEOUT_MS = 10_000;

/** Probed in order when the remote's default branch is not configured locally. */
const BASE_REFS = ["origin/main", "origin/master", "main", "master"];

/** Git output kept for one command; what follows is dropped and makes the result incomplete. */
const MAX_OUTPUT_BYTES = MAX_PATCH_BYTES * 2;

/** What one read of a project found. */
export type ChangesRead =
  | { status: "ready"; base: string; files: ChangedFile[]; message?: string }
  | { status: "notRepository" | "error"; message: string }
  /** A command could not run at all; the list as it stands stays, and the next read tries again. */
  | { status: "unreadable" };

/**
 * Reads one project's changes from Git, remembering what a read cannot change: whether the directory is a repository,
 * which integration branch the list is measured against, and the line counts of untracked files whose size and
 * modification time are the same as they were. A manual refresh forgets those, so a repository created or given a
 * remote in between is noticed.
 */
export class ChangeReader {
  readonly #env: ExecutionEnv;
  readonly #root: string;
  #repository = false;
  #baseRef: string | null | undefined;
  #base = "HEAD";
  readonly #untracked = new Map<string, { size: number; mtimeMs: number; additions: number | undefined }>();

  constructor(env: ExecutionEnv, root: string) {
    this.#env = env;
    this.#root = root;
  }

  /** Forget what is remembered between reads. */
  forget(): void {
    this.#repository = false;
    this.#baseRef = undefined;
    this.#untracked.clear();
  }

  /** The list as it is now: branch commits, staged and unstaged work, and untracked files against the same base. */
  async read(context: Context): Promise<ChangesRead> {
    if (!this.#repository) {
      const repository = await this.#git(["rev-parse", "--git-dir"], context);
      if (repository === undefined) {
        return { status: "error", message: "Cannot run Git. Is it installed and on the PATH?" };
      }
      if (repository.code !== 0) {
        return { status: "notRepository", message: "This directory is not in a Git repository." };
      }
      this.#repository = true;
    }
    const baseRef = await this.#resolveBaseRef(context);
    this.#base = baseRef === undefined ? "HEAD" : await this.#mergeBase(baseRef, context);
    const tracked = await this.#trackedFiles(context);
    if (tracked === undefined) return { status: "error", message: "Cannot read this repository's changes." };
    const untracked = await this.#untrackedFiles(context);
    if (untracked === undefined) return { status: "unreadable" };

    const files = [...tracked, ...untracked].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    const listed = files.slice(0, MAX_CHANGED_FILES);
    const truncated = files.length > listed.length;
    return {
      status: "ready",
      base: baseRef ?? "HEAD",
      files: listed,
      ...(truncated ? { message: `Only the first ${MAX_CHANGED_FILES} changed files are listed.` } : {}),
    };
  }

  /** One file's patch against the same base; `binary` is what the list already said about it. */
  async diff(path: string, kind: { untracked: boolean; binary: boolean }, context: Context): Promise<FilePatch> {
    if (kind.binary) return { kind: "binary" };
    // An untracked file is not in the base commit at all, so it is compared with nothing; `--relative` keeps the
    // paths in the patch the project's own, as they are for a tracked file.
    const run = await this.#git(
      kind.untracked
        ? ["diff", "--no-index", "--no-color", "--", "/dev/null", path]
        : ["diff", "--relative", "--no-color", this.#base, "--", path],
      context,
    );
    // A path the client may not ask about rejects before this; Git failing to read a file it could read a moment ago is
    // an outcome the panel shows.
    if (run === undefined) return { kind: "unavailable", message: "Cannot run Git" };
    // `--no-index` answers 1 when the files differ, which for an untracked file is every case.
    if (run.code !== 0 && !(kind.untracked && run.code === 1)) {
      return { kind: "unavailable", message: run.stderr.trim() === "" ? "Cannot read the diff" : run.stderr.trim() };
    }
    if (run.truncated) return { kind: "tooLarge" };
    return { kind: "patch", patch: run.stdout };
  }

  /** The commit the list is measured from, named for the panel: the integration branch when there is one. */
  async #resolveBaseRef(context: Context): Promise<string | undefined> {
    if (this.#baseRef !== undefined) return this.#baseRef ?? undefined;
    const advertised = await this.#git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], context);
    if (advertised !== undefined && advertised.code === 0 && advertised.stdout.trim() !== "") {
      this.#baseRef = advertised.stdout.trim();
      return this.#baseRef;
    }
    for (const ref of BASE_REFS) {
      const found = await this.#git(["rev-parse", "--verify", "--quiet", ref], context);
      if (found !== undefined && found.code === 0) {
        this.#baseRef = ref;
        return ref;
      }
    }
    this.#baseRef = null;
    return undefined;
  }

  /** The changed tracked files, or `undefined` when Git cannot say. */
  async #trackedFiles(context: Context): Promise<ChangedFile[] | undefined> {
    // Git prints one summary at a time, so the statuses and the line counts take two commands.
    const [names, numbers] = await Promise.all([
      this.#diffSummary("--name-status", context),
      this.#diffSummary("--numstat", context),
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
  async #diffSummary(summary: string, context: Context): Promise<string | undefined> {
    const base = await this.#git(["diff", "--relative", summary, "-z", this.#base, "--"], context);
    if (base !== undefined && base.code === 0) return base.stdout;
    const index = await this.#git(["diff", "--relative", summary, "-z", "--cached", "--"], context);
    return index !== undefined && index.code === 0 ? index.stdout : undefined;
  }

  /** Every untracked file, with the lines it would add; Git's ignore rules leave theirs out. */
  async #untrackedFiles(context: Context): Promise<ChangedFile[] | undefined> {
    const listed = await this.#git(["ls-files", "--others", "--exclude-standard", "-z"], context);
    if (listed === undefined) return undefined;
    if (listed.code !== 0) return [];
    const paths = listed.stdout.split("\0").filter((path) => path !== "");
    const counted = new Map<string, { size: number; mtimeMs: number; additions: number | undefined }>();
    const files = await Promise.all(
      paths.slice(0, MAX_UNTRACKED_FILES).map(async (path): Promise<ChangedFile> => {
        const target = `${this.#root}/${path}`;
        const info = await this.#env.fileInfo(target, context);
        const size = info.ok ? info.value.size : 0;
        const mtimeMs = info.ok ? info.value.mtimeMs : 0;
        const previous = this.#untracked.get(path);
        // Counting reads the whole file, so an unchanged one keeps the count it had.
        const additions =
          previous !== undefined && info.ok && previous.size === size && previous.mtimeMs === mtimeMs
            ? previous.additions
            : await addedLines(this.#env, target, context);
        counted.set(path, { size, mtimeMs, additions });
        return withoutEmpty({ path, status: "untracked" as const, additions });
      }),
    );
    this.#untracked.clear();
    for (const [path, count] of counted) this.#untracked.set(path, count);
    return files;
  }

  async #mergeBase(baseRef: string, context: Context): Promise<string> {
    const base = await this.#git(["merge-base", baseRef, "HEAD"], context);
    const value = base?.stdout.trim() ?? "";
    if (base === undefined || base.code !== 0 || value === "") return "HEAD";
    // A merge in progress leaves HEAD at the pre-merge tip while the working tree already holds the merged work, which
    // must not count as this branch's additions.
    let advanced = value;
    for (const head of await this.#mergedHeads(context)) {
      const candidate = await this.#git(["merge-base", baseRef, head], context);
      const commit = candidate?.stdout.trim() ?? "";
      // Incomparable candidates have no single newest base: keep the one in hand.
      if (candidate === undefined || candidate.code !== 0 || commit === "" || commit === advanced) continue;
      const ancestor = await this.#git(["merge-base", "--is-ancestor", advanced, commit], context);
      if (ancestor !== undefined && ancestor.code === 0) advanced = commit;
    }
    return advanced;
  }

  /** Every head of an in-progress merge, including octopus merges and worktrees. */
  async #mergedHeads(context: Context): Promise<string[]> {
    const path = await this.#git(["rev-parse", "--git-path", "MERGE_HEAD"], context);
    const file = path?.stdout.trim() ?? "";
    if (path === undefined || path.code !== 0 || file === "") return [];
    const text = await this.#env.readTextFile(isAbsolute(file) ? file : join(this.#root, file), context);
    if (!text.ok) return [];
    return text.value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }

  /** Run Git in the project's directory. `undefined` when the command could not be run at all. */
  async #git(args: readonly string[], context: Context): Promise<GitRun | undefined> {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const result = await this.#env.exec(
      ["git", ...args],
      {
        cwd: this.#root,
        timeout: GIT_TIMEOUT_MS,
        onOutput: (text, _context, info) => {
          if (info.stream !== "stdout") {
            if (stderr.length < MAX_OUTPUT_BYTES) stderr += text;
            return;
          }
          stdout += text;
          if (stdout.length > MAX_OUTPUT_BYTES) {
            stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
            truncated = true;
          }
        },
      },
      context,
    );
    if (!result.ok) return undefined;
    return { code: result.value.exitCode, stdout, stderr, truncated };
  }
}

interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
  /** The command wrote more than was kept. */
  truncated: boolean;
}

/** An absent value is left out: a replicated state holds JSON, which has no `undefined`. */
function withoutEmpty<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
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
