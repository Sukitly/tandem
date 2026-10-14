import type { FileEntry } from "@tandem/contracts";
import { isHidden } from "./hidden.ts";

/**
 * Whether an entry's row is dimmed, as VS Code dims what is excluded or ignored:
 * Git-ignored entries, excluded files shown when hidden files are toggled on (e.g. `.git`, `.DS_Store`),
 * and everything below a dimmed directory.
 * Regular project dotfiles like `.gitignore` or `.editorconfig` remain at normal opacity unless Git ignores them.
 */
export function isDimmed(entry: FileEntry, parentDimmed: boolean): boolean {
  return parentDimmed || entry.ignored === true || isHidden(entry.name);
}
