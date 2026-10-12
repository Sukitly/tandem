import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";

/** How a file differs from the base commit. */
export type ChangeStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "typeChanged"
  | "conflicted"
  /** Git does not track it yet; every line counts as added. */
  | "untracked";

/** One file that differs from the base commit. */
export interface ChangedFile {
  /** From the project's directory, separated by `/`. */
  path: string;
  status: ChangeStatus;
  /** What a rename or a copy came from, from the project's directory. */
  from?: string;
  /** Lines added and deleted; absent for a binary file. */
  additions?: number;
  deletions?: number;
}

/**
 * What the base commit is: the merge base with the project's integration branch, so the list holds branch commits,
 * staged and unstaged work, and untracked files together. A project without an integration branch is compared with its
 * last commit.
 */
export interface ChangesState {
  workspaceId: number;
  /** `notRepository` when the directory is not in a Git repository; `error` when the list cannot be read at all. */
  status: "ready" | "notRepository" | "error";
  /** What the files are compared with, for example `origin/main` or `HEAD`; absent while unavailable. */
  base?: string;
  /** Ascending by path. */
  files: ChangedFile[];
  /** Why the list is unavailable or incomplete, for example that watching stopped. */
  message?: string;
}

/** A patch larger than this is not sent; the panel says so instead. */
export const MAX_PATCH_BYTES = 512 * 1024;

/** Most changed files one project lists; a repository with more reports that the rest are missing. */
export const MAX_CHANGED_FILES = 2000;

/** Untracked files counted for their added lines: the first ones, by Git's order. */
export const MAX_UNTRACKED_FILES = 200;

/** An untracked file larger than this counts as no added lines. */
export const MAX_UNTRACKED_BYTES = 512 * 1024;

export type FilePatch =
  | { kind: "patch"; patch: string }
  /** Git reports no line changes for it. */
  | { kind: "binary" }
  | { kind: "tooLarge" }
  /** Git could not read it; the message says why. Whether a file is binary, and whether its patch is too large, is
   * decided here, so that a client shows the outcome rather than judging the file again. */
  | { kind: "unavailable"; message: string };

/** The changes of one project, watched while a client holds it open. */
export interface ProjectChanges {
  readonly state: ReplicatedState<ChangesState>;
  /** Read a file's patch, from the project's directory; `""` is the whole project. */
  diff(path: string, context: Context): Promise<FilePatch>;
  /** Read the changes again, and watch again if watching had stopped. */
  refresh(context: Context): Promise<void>;
}

/** The projects whose changes clients watch. Instances end with the connection that opened them. */
export interface Changes {
  open(workspaceId: number, context: Context): Promise<void>;
  close(workspaceId: number, context: Context): Promise<void>;
}

export const ProjectChanges = defineService<ProjectChanges>("tandem.projectChanges");

export const Changes = defineService<Changes>("tandem.changes");
