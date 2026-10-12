/** A place in a project's changes the user asked to see: a file of the diff, and the line in it. */
export interface ChangeTarget {
  /** The project the place belongs to. */
  workspaceId: number;
  path: string;
  /** 1-based, as the file numbers it. */
  line?: number;
  /** Which side of the diff the line is on; the new file's when it is not known. */
  side?: "additions" | "deletions";
  /** A comment thread asked for: shown at the line it is on now, which `line` was when it was written. */
  threadId?: number;
}
