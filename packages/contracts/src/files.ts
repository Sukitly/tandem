import { type Context, defineService } from "@earendil-works/chord";

/** A file or directory in a project. */
export interface FileEntry {
  name: string;
  /** From the project's directory, separated by `/`. */
  path: string;
  /** For a symbolic link, what it points to; a broken link is a file. */
  kind: "file" | "directory";
  symlink?: true;
  /** A file's size in bytes, of what a symbolic link points to; absent for directories and broken links. */
  size?: number;
  /** Git ignores it: a `.gitignore` rule, `.git/info/exclude`, or the global excludes file. Tracked files are not. */
  ignored?: true;
}

/** Files larger than this are not sent; the viewer says so instead. */
export const MAX_FILE_VIEW_BYTES = 1024 * 1024;

export type FileContent =
  | { kind: "text"; text: string; size: number }
  /** Contains a NUL byte, as Git judges it. */
  | { kind: "binary"; size: number }
  | { kind: "tooLarge"; size: number };

export interface FileLocation {
  workspaceId: number;
  /** From the project's directory, separated by `/`; `""` is the directory itself. */
  path: string;
}

/**
 * The files of the projects, as they are on disk: every entry, hidden and ignored ones too. Paths stay inside their
 * project's directory, also through symbolic links.
 */
export interface Files {
  /** A directory's entries: directories first, then files, each by name. */
  list(location: FileLocation, context: Context): Promise<FileEntry[]>;
  read(location: FileLocation, context: Context): Promise<FileContent>;
}

export const Files = defineService<Files>("tandem.files");
