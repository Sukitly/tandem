import { parsePatchFiles } from "@pierre/diffs";
import type { CommentThread } from "@tandem/contracts";
import { expect, test, vi } from "vitest";
import { diffLineCount, diffLines } from "../src/changes/diff-lines.ts";
import { placeThreads, threadsByLine } from "../src/comments/comment-anchor.ts";

const thread: CommentThread = {
  id: 1,
  workspaceId: 1,
  anchor: { path: "file.ts", line: 2, quote: "new", before: [], after: [] },
  messages: [],
};

test("a diff's lines are numbered as each side numbers them, and end where the hunk does", () => {
  const patch = [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,3 +1,4 @@",
    " const one = 1;",
    "-const two = 2;",
    "+const two = 22;",
    "+const extra = 0;",
    " const three = 3;",
  ].join("\n");
  const file = parsePatchFiles(patch).flatMap((entry) => entry.files)[0];
  if (file === undefined) throw new Error("Patch did not parse");
  expect([...diffLines(file, "additions")]).toEqual([
    [1, "const one = 1;"],
    [2, "const two = 22;"],
    [3, "const extra = 0;"],
    [4, "const three = 3;"],
  ]);
  expect([...diffLines(file, "deletions")]).toEqual([
    [1, "const one = 1;"],
    [2, "const two = 2;"],
    [3, "const three = 3;"],
  ]);
  expect(diffLineCount(file, "additions")).toBe(4);
  expect(diffLineCount(file, "deletions")).toBe(3);
});

test("a hunk at a billion lines is indexed by patch size, on both sides", () => {
  const patch = [
    "diff --git a/file.ts b/file.ts",
    "--- a/file.ts",
    "+++ b/file.ts",
    "@@ -1000000000,3 +1000000000,3 @@",
    " before",
    "-old",
    "+new",
    " after",
  ].join("\n");
  const file = parsePatchFiles(patch).flatMap((entry) => entry.files)[0];
  if (file === undefined) throw new Error("Patch did not parse");
  for (const side of ["additions", "deletions"] as const) {
    const lines = diffLines(file, side);
    expect(lines.size).toBe(3);
    expect(lines.get(1)).toBeUndefined();
    const lineAt = vi.fn((line: number) => {
      if (lineAt.mock.calls.length > 20) throw new Error("Scanned a missing range");
      return lines.get(line);
    });
    const placed = placeThreads(
      [{ ...thread, anchor: { ...thread.anchor, side, quote: side === "additions" ? "new" : "old" } }],
      "file.ts",
      side,
      lineAt,
      diffLineCount(file, side),
      lines.keys(),
    );
    expect(placed[0]?.line).toBe(1000000001);
    expect(lineAt.mock.calls.length).toBeLessThan(20);
  }
});

test("dense file placement reads the file once rather than once per missing comment", () => {
  const lines = Array.from({ length: 1000 }, (_, index) => `line ${index}`);
  const lineAt = vi.fn((line: number) => lines[line - 1]);
  const threads = Array.from({ length: 50 }, (_, id) => ({ ...thread, id }));
  expect(
    placeThreads(threads, "file.ts", "additions", lineAt, lines.length).every((entry) => entry.line === undefined),
  ).toBe(true);
  expect(lineAt.mock.calls.length).toBeLessThanOrEqual(1100);
});

test("unchanged anchors do not build a whole-file index", () => {
  const lineAt = vi.fn((line: number) => {
    if (lineAt.mock.calls.length > 10) throw new Error("Unnecessary index");
    return line === 2 ? "new" : undefined;
  });
  expect(placeThreads([thread], "file.ts", "additions", lineAt, 1000000000)[0]?.line).toBe(2);
  expect(lineAt).toHaveBeenCalledOnce();
});

test("line groups retain multiple comments and exclude detached threads", () => {
  const second = { ...thread, id: 2 };
  const grouped = threadsByLine([
    { thread, line: 3 },
    { thread: second, line: 3 },
    { thread: { ...thread, id: 4 }, line: undefined },
  ]);
  expect([...grouped]).toEqual([[3, [thread, second]]]);
});
