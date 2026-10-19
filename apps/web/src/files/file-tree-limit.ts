import type { FileEntry } from "@tandem/contracts";

/**
 * How many entries of one directory to render before cutting off and offering to show more. A huge directory (thousands
 * of files) in a non-virtualized tree balloons DOM node count and degrades layout across the whole page.
 */
export const DIRECTORY_ENTRY_LIMIT = 300;

export interface TruncatedEntries {
  shown: readonly FileEntry[];
  remaining: number;
}

export function truncateEntries(
  entries: readonly FileEntry[],
  limit: number = DIRECTORY_ENTRY_LIMIT,
): TruncatedEntries {
  if (entries.length <= limit) return { shown: entries, remaining: 0 };
  return { shown: entries.slice(0, limit), remaining: entries.length - limit };
}
