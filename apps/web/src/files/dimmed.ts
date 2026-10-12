import type { FileEntry } from "@tandem/contracts";

/**
 * Whether an entry's row is dimmed, as VS Code dims what it hides: hidden entries (a leading dot, so `.git`,
 * `.gitignore`, `.env` too) and what Git ignores. Everything below such a directory is dimmed with it, which also
 * covers an ignored directory's contents: Git reports the directory, not what is inside it.
 */
export function isDimmed(entry: FileEntry, parentDimmed: boolean): boolean {
  return parentDimmed || entry.name.startsWith(".") || entry.ignored === true;
}
