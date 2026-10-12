import { describe, expect, test } from "vitest";
import { commentMessage, commentPlace, type LineComment } from "../src/comments/line-comment.ts";

function comment(change: Partial<LineComment> = {}): LineComment {
  return {
    id: "1",
    path: "src/app.ts",
    line: 42,
    quote: "const retries = 3",
    text: "Read this from the config.",
    ...change,
  };
}

describe("a message carrying review comments", () => {
  test("names the place, the line, and the note", () => {
    expect(commentMessage([comment()], "")).toBe(
      ["[src/app.ts:42](src/app.ts#L42)", "> const retries = 3", "Read this from the config."].join("\n\n"),
    );
  });

  test("carries several comments, each about its own line", () => {
    const message = commentMessage([comment(), comment({ id: "2", line: 88, quote: "", text: "And here." })], "");
    expect(message.split("\n\n")).toEqual([
      "[src/app.ts:42](src/app.ts#L42)",
      "> const retries = 3",
      "Read this from the config.",
      "[src/app.ts:88](src/app.ts#L88)",
      "And here.",
    ]);
  });

  test("keeps what the user typed after the comments", () => {
    expect(
      commentMessage([comment()], " Also rename it. ").endsWith("Read this from the config.\n\nAlso rename it."),
    ).toBe(true);
  });

  test("is what the user typed when there are no comments", () => {
    expect(commentMessage([], " Just a message. ")).toBe("Just a message.");
  });

  test("is nothing when there is neither", () => {
    expect(commentMessage([], "  ")).toBe("");
    expect(commentMessage([comment({ quote: "", text: "" })], "")).toBe("[src/app.ts:42](src/app.ts#L42)");
  });

  test("names a place as a person writes it", () => {
    expect(commentPlace(comment({ path: "apps/web/src/App.tsx", line: 7 }))).toBe("apps/web/src/App.tsx:7");
  });
});
