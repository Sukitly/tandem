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

/**
 * The letter's color: what the change does to the file, not how it differs from the base commit. A file that already
 * differs and is deleted again is still a deletion.
 */
export function statusColor(status: ChangeStatus): string {
  switch (status) {
    case "added":
    case "untracked":
      return "text-emerald-600 dark:text-emerald-400";
    case "deleted":
      return "text-red-600 dark:text-red-400";
    case "renamed":
    case "copied":
      return "text-sky-600 dark:text-sky-400";
    case "conflicted":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

/** `+3 −1`, or nothing when Git counts no lines; a binary file has neither count. */
export function countsLabel(additions?: number, deletions?: number): string {
  const parts: string[] = [];
  if (additions !== undefined && additions > 0) parts.push(`+${additions}`);
  if (deletions !== undefined && deletions > 0) parts.push(`−${deletions}`);
  return parts.join(" ");
}
