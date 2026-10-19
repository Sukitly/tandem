import type { AnnotationSide, FileDiffMetadata } from "@pierre/diffs";

/** Sparse line lookup: work and memory depend on patch size, not on the last hunk's line number. */
export function diffLines(fileDiff: FileDiffMetadata, side: AnnotationSide): Map<number, string> {
  const result = new Map<number, string>();
  const source = side === "additions" ? fileDiff.additionLines : fileDiff.deletionLines;
  for (const hunk of fileDiff.hunks) {
    const start = side === "additions" ? hunk.additionStart : hunk.deletionStart;
    const count = side === "additions" ? hunk.additionCount : hunk.deletionCount;
    const index = side === "additions" ? hunk.additionLineIndex : hunk.deletionLineIndex;
    for (let offset = 0; offset < count; offset += 1) {
      const text = source[index + offset];
      if (text !== undefined) result.set(start + offset, text.replace(/\r?\n$/, ""));
    }
  }
  return result;
}

/** The highest line number a side of the diff shows. */
export function diffLineCount(fileDiff: FileDiffMetadata, side: AnnotationSide): number {
  let highest = 0;
  for (const hunk of fileDiff.hunks) {
    const start = side === "additions" ? hunk.additionStart : hunk.deletionStart;
    const count = side === "additions" ? hunk.additionCount : hunk.deletionCount;
    if (count > 0) highest = Math.max(highest, start + count - 1);
  }
  return highest;
}
