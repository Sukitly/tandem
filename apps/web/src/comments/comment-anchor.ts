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
  candidates: Iterable<number> = lineNumbers(count),
): number | undefined {
  if (lineAt(anchor.line) === anchor.quote && surrounding(anchor, lineAt, anchor.line) === full(anchor)) {
    return anchor.line;
  }
  // A blank line says nothing about where it is.
  if (anchor.quote.trim() === "") return lineAt(anchor.line) === anchor.quote ? anchor.line : undefined;
  let best: { line: number; score: number; distance: number } | undefined;
  for (const line of candidates) {
    if (lineAt(line) !== anchor.quote) continue;
    const candidate = {
      line,
      score: surrounding(anchor, lineAt, line),
      distance: Math.abs(line - anchor.line),
    };
    if (
      best === undefined ||
      candidate.score > best.score ||
      (candidate.score === best.score &&
        (candidate.distance < best.distance || (candidate.distance === best.distance && candidate.line < best.line)))
    )
      best = candidate;
  }
  return best?.line;
}

/** Enumerate dense files lazily; sparse diffs supply only their visible line numbers. */
function* lineNumbers(count: number): Iterable<number> {
  for (let line = 1; line <= count; line += 1) yield line;
}

/** Index each shown line once, rather than scanning the entire file again for every comment. */
export function indexLines(
  lineAt: (line: number) => string | undefined,
  numbers: Iterable<number> | number,
): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (const line of typeof numbers === "number" ? lineNumbers(numbers) : numbers) {
    const text = lineAt(line);
    if (text === undefined) continue;
    const matches = index.get(text);
    if (matches === undefined) index.set(text, [line]);
    else matches.push(line);
  }
  return index;
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
  numbers: Iterable<number> = lineNumbers(count),
): PlacedThread[] {
  const matching = threads.filter(
    (thread) => thread.anchor.path === path && (thread.anchor.side ?? "additions") === side,
  );
  if (matching.length === 0) return [];
  let index: Map<string, number[]> | undefined;
  return matching.map((thread) => {
    // Unchanged anchors and blank lines do not need a whole-file index.
    const direct = relocate(thread.anchor, lineAt, count, []);
    if (direct !== undefined || thread.anchor.quote.trim() === "") return { thread, line: direct };
    index ??= indexLines(lineAt, numbers);
    return { thread, line: relocate(thread.anchor, lineAt, count, index.get(thread.anchor.quote) ?? []) };
  });
}

/** One lookup per rendered line, including all threads sharing that line. */
export function threadsByLine(placed: readonly PlacedThread[]): Map<number, CommentThread[]> {
  const result = new Map<number, CommentThread[]>();
  for (const { line, thread } of placed) {
    if (line === undefined) continue;
    const group = result.get(line);
    if (group === undefined) result.set(line, [thread]);
    else group.push(thread);
  }
  return result;
}

/**
 * The line to show for a place that was asked for. A thread asked for is shown where it is now: on the line its text
 * moved to, or, outdated, at no line, since it is shown above the text. A thread that is not among them is gone, and
 * the line asked for is all there is.
 */
export function revealedLine(
  placed: readonly PlacedThread[],
  threadId: number | undefined,
  line: number | undefined,
): number | undefined {
  if (threadId === undefined) return line;
  const entry = placed.find((candidate) => candidate.thread.id === threadId);
  return entry === undefined ? line : entry.line;
}

/** Where a thread is, as a person writes it: `src/app.ts:42`. */
export function commentPlace(anchor: Pick<CommentAnchor, "path" | "line">): string {
  return `${anchor.path}:${anchor.line}`;
}
