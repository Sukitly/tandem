/**
 * Files and directories excluded by default in developer editors like VS Code (`files.exclude`):
 * version control internal metadata and OS metadata files.
 */
export const DEFAULT_EXCLUDED_NAMES = new Set([".git", ".svn", ".hg", "CVS", ".DS_Store", "Thumbs.db"]);

/**
 * Whether a file or directory is considered hidden/excluded by default.
 * Regular dotfiles like `.gitignore`, `.editorconfig`, `.env` are standard project configuration files
 * and are not hidden.
 */
export function isHidden(name: string): boolean {
  return DEFAULT_EXCLUDED_NAMES.has(name) || name.startsWith("._");
}
