import type { CommentAnchor, CommentThread } from "@tandem/contracts";
import { describe, expect, test } from "vitest";
import { anchorAt, commentPlace, placeThreads, relocate } from "../src/comments/comment-anchor.ts";
import { waitingComments } from "../src/comments/project-comments.ts";

const FILE = [
  "import { load } from './config';", // 1
  "", // 2
  "function start() {", // 3
  "  const retries = 3;", // 4
  "  return retries;", // 5
  "}", // 6
];

function reader(lines: readonly string[]) {
  return (line: number): string | undefined => lines[line - 1];
}

const anchor: CommentAnchor = anchorAt({ path: "src/app.ts", line: 4 }, reader(FILE));

describe("what a thread keeps of its line", () => {
  test("is the line, and up to three lines on each side", () => {
    expect(anchor).toEqual({
      path: "src/app.ts",
      line: 4,
      quote: "  const retries = 3;",
      before: ["import { load } from './config';", "", "function start() {"].slice(-3),
      after: ["  return retries;", "}"],
    });
  });

  test("stops where the text shows no more lines", () => {
    const shown = (line: number) => (line >= 3 && line <= 5 ? FILE[line - 1] : undefined);
    expect(anchorAt({ path: "a", line: 4, side: "deletions" }, shown)).toMatchObject({
      side: "deletions",
      before: ["function start() {"],
      after: ["  return retries;"],
    });
  });
});

describe("finding a thread's line again", () => {
  test("is where it was when nothing moved", () => {
    expect(relocate(anchor, reader(FILE), FILE.length)).toBe(4);
  });

  test("follows the line when lines are added above it", () => {
    const moved = ["// header", "// more", ...FILE];
    expect(relocate(anchor, reader(moved), moved.length)).toBe(6);
  });

  test("takes the copy whose surroundings match, not the nearest one", () => {
    const twice = ["function other() {", "  const retries = 3;", "  return 0;", "}", "", ...FILE];
    // The copy at line 2 is nearer the old number 4, but only the copy at line 9 has the same neighbours.
    expect(relocate(anchor, reader(twice), twice.length)).toBe(9);
  });

  test("takes the nearest of copies that match equally", () => {
    const lines = ["x", "  const retries = 3;", "x", "x", "x", "x", "  const retries = 3;", "x"];
    const bare = { ...anchor, before: [], after: [] };
    expect(relocate({ ...bare, line: 6 }, reader(lines), lines.length)).toBe(7);
    expect(relocate({ ...bare, line: 3 }, reader(lines), lines.length)).toBe(2);
  });

  test("is nothing once the line is gone: the thread is outdated", () => {
    const edited = FILE.map((line) => (line === "  const retries = 3;" ? "  const retries = config.retries;" : line));
    expect(relocate(anchor, reader(edited), edited.length)).toBeUndefined();
  });

  test("does not hunt for a blank line elsewhere", () => {
    const blank = anchorAt({ path: "a", line: 2 }, reader(FILE));
    expect(relocate(blank, reader(FILE), FILE.length)).toBe(2);
    const shifted = ["x", ...FILE];
    expect(relocate(blank, reader(shifted), shifted.length)).toBeUndefined();
  });
});

function thread(id: number, change: Partial<CommentThread> = {}): CommentThread {
  return {
    id,
    workspaceId: 1,
    anchor,
    messages: [{ id: id * 10, author: "user", text: `note ${id}`, createdAt: 0 }],
    ...change,
  };
}

describe("the threads of a file", () => {
  test("are those of its path and side, each on its line or outdated", () => {
    const threads = [
      thread(1),
      thread(2, { anchor: { ...anchor, path: "other.ts" } }),
      thread(3, { anchor: { ...anchor, side: "deletions" } }),
      thread(4, { anchor: { ...anchor, quote: "gone" } }),
    ];
    expect(
      placeThreads(threads, "src/app.ts", "additions", reader(FILE), FILE.length).map(({ thread, line }) => [
        thread.id,
        line,
      ]),
    ).toEqual([
      [1, 4],
      [4, undefined],
    ]);
  });

  test("name their place as a person writes it", () => {
    expect(commentPlace({ path: "apps/web/src/App.tsx", line: 7 })).toBe("apps/web/src/App.tsx:7");
  });
});

describe("what the next message carries", () => {
  test("is every user message that has not been sent, in order", () => {
    const sent = { conversationId: 1, requestId: "r" };
    const threads = [
      thread(1, {
        messages: [
          { id: 1, author: "user", text: "sent", createdAt: 0, sent },
          { id: 2, author: "agent", text: "answer", createdAt: 0, conversationId: 1 },
          { id: 3, author: "user", text: "reply", createdAt: 0 },
        ],
      }),
      thread(2),
    ];
    expect(waitingComments(threads).map((comment) => [comment.thread.id, comment.messageId, comment.text])).toEqual([
      [1, 3, "reply"],
      [2, 20, "note 2"],
    ]);
  });
});
