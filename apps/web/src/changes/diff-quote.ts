import type { AnnotationSide, FileDiffMetadata } from "@pierre/diffs";

/**
 * The text of a line of a parsed diff, numbered as the given side numbers it. `undefined` when the line is not part of
 * the patch—a hunk that is collapsed, or a line beyond it.
 *
 * A hunk's lines run contiguously on each side from the line its header names, and `additionLines`/`deletionLines` hold
 * the patch's lines in the same order, from the index the hunk records. A line keeps its line ending there; it is
 * dropped here, because the text stands on its own where it is written down.
 */
export function diffQuote(fileDiff: FileDiffMetadata, side: AnnotationSide, line: number): string | undefined {
  for (const hunk of fileDiff.hunks) {
    const start = side === "additions" ? hunk.additionStart : hunk.deletionStart;
    const count = side === "additions" ? hunk.additionCount : hunk.deletionCount;
    if (line < start || line >= start + count) continue;
    const index = (side === "additions" ? hunk.additionLineIndex : hunk.deletionLineIndex) + (line - start);
    const text = (side === "additions" ? fileDiff.additionLines : fileDiff.deletionLines)[index];
    return text?.replace(/\r?\n$/, "");
  }
  return undefined;
}
