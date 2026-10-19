import type { ChangeStatus } from "@tandem/contracts";

/** The letter Git uses for a status, so a row reads like `git status`. */
export function statusLetter(status: ChangeStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "typeChanged":
      return "T";
    case "conflicted":
      return "U";
    case "untracked":
      return "?";
    default:
      return "M";
  }
}

/** How a row names the change; a rename says where it came from. */
export function statusLabel(status: ChangeStatus, from?: string): string {
  const label = status === "untracked" ? "untracked" : status.replace(/([A-Z])/g, " $1").toLowerCase();
  return from === undefined ? label : `${label} from ${from}`;
}

/** Added lines, and the files that are only lines added. */
export const ADDITIONS_COLOR = "text-emerald-700 dark:text-emerald-400";

/** Deleted lines, and the files that are only lines deleted. */
export const DELETIONS_COLOR = "text-red-700 dark:text-red-400";

/**
 * The letter's color: what the change does to the file, not how it differs from the base commit. A file that already
 * differs and is deleted again is still a deletion.
 */
export function statusColor(status: ChangeStatus): string {
  switch (status) {
    case "added":
    case "untracked":
      return ADDITIONS_COLOR;
    case "deleted":
      return DELETIONS_COLOR;
    case "renamed":
    case "copied":
      return "text-sky-600 dark:text-sky-400";
    case "conflicted":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

export interface CountPart {
  kind: "additions" | "deletions";
  text: string;
}

/**
 * A file's line counts, each apart so that the added lines and the deleted ones are colored differently. A count of
 * zero is left out; a binary file has neither.
 */
export function countParts(additions?: number, deletions?: number): CountPart[] {
  const parts: CountPart[] = [];
  if (additions !== undefined && additions > 0) parts.push({ kind: "additions", text: `+${additions}` });
  if (deletions !== undefined && deletions > 0) parts.push({ kind: "deletions", text: `−${deletions}` });
  return parts;
}
