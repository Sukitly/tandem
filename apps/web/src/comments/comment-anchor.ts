import { COMMENT_CONTEXT_LINES, type CommentAnchor, type CommentThread } from "@tandem/contracts";

/**
 * Where a thread's line is now, in the text it is shown against. Line numbers move as the file changes, so the line is
 * looked for by its text: where it was, else the copy whose surrounding lines match the kept ones best, nearest the old
 * number when they match equally. `undefined` when the line's text is nowhere: the thread is outdated.
 *
 * `lineAt` reads a line by its 1-based number, `undefined` when the text does not show it—a diff shows only the lines
 * of its hunks. `count` is the highest line number there is.
 */
export function relocate(
  anchor: CommentAnchor,
  lineAt: (line: number) => string | undefined,
  count: number,
): number | undefined {
  if (lineAt(anchor.line) === anchor.quote && surrounding(anchor, lineAt, anchor.line) === full(anchor)) {
    return anchor.line;
  }
  // A blank line says nothing about where it is.
  if (anchor.quote.trim() === "") return lineAt(anchor.line) === anchor.quote ? anchor.line : undefined;
  let best: { line: number; score: number; distance: number } | undefined;
  for (let line = 1; line <= count; line += 1) {
    if (lineAt(line) !== anchor.quote) continue;
    const candidate = {
      line,
      score: surrounding(anchor, lineAt, line),
      distance: Math.abs(line - anchor.line),
    };
    if (
      best === undefined ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.distance < best.distance)
    )
      best = candidate;
  }
  return best?.line;
}

/** How many of the kept lines around the thread's line are still beside a line. */
function surrounding(anchor: CommentAnchor, lineAt: (line: number) => string | undefined, line: number): number {
  let score = 0;
  anchor.before.forEach((text, index) => {
    if (lineAt(line - anchor.before.length + index) === text) score += 1;
  });
  anchor.after.forEach((text, index) => {
    if (lineAt(line + 1 + index) === text) score += 1;
  });
  return score;
}

function full(anchor: CommentAnchor): number {
  return anchor.before.length + anchor.after.length;
}

/**
 * What a new thread keeps of its line: the line's text and the lines around it, as far as they are known. A line the
 * text does not show stops the context there.
 */
export function anchorAt(
  place: Pick<CommentAnchor, "path" | "line" | "side">,
  lineAt: (line: number) => string | undefined,
): CommentAnchor {
  const before: string[] = [];
  for (let line = place.line - 1; line >= place.line - COMMENT_CONTEXT_LINES; line -= 1) {
    const text = lineAt(line);
    if (text === undefined) break;
    before.unshift(text);
  }
  const after: string[] = [];
  for (let line = place.line + 1; line <= place.line + COMMENT_CONTEXT_LINES; line += 1) {
    const text = lineAt(line);
    if (text === undefined) break;
    after.push(text);
  }
  return {
    path: place.path,
    line: place.line,
    ...(place.side === undefined ? {} : { side: place.side }),
    quote: lineAt(place.line) ?? "",
    before,
    after,
  };
}

/** A thread placed against the text it is shown with: on a line, or outdated. */
export type PlacedThread = { thread: CommentThread; line: number } | { thread: CommentThread; line: undefined };

/**
 * The threads of one file, each on its line now or outdated. `side` picks the threads of one side of a diff; a file's
 * text is the additions side.
 */
export function placeThreads(
  threads: readonly CommentThread[],
  path: string,
  side: "additions" | "deletions",
  lineAt: (line: number) => string | undefined,
  count: number,
): PlacedThread[] {
  return threads
    .filter((thread) => thread.anchor.path === path && (thread.anchor.side ?? "additions") === side)
    .map((thread) => ({ thread, line: relocate(thread.anchor, lineAt, count) }));
}

/** Where a thread is, as a person writes it: `src/app.ts:42`. */
export function commentPlace(anchor: Pick<CommentAnchor, "path" | "line">): string {
  return `${anchor.path}:${anchor.line}`;
}
