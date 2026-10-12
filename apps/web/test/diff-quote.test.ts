import { parsePatchFiles } from "@pierre/diffs";
import { describe, expect, test } from "vitest";
import { diffQuote } from "../src/changes/diff-quote.ts";

/** One file, one hunk: a context line, a change, and a context line after it. */
const PATCH = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,3 +1,4 @@",
  " const one = 1;",
  "-const two = 2;",
  "+const two = 22;",
  "+const extra = 0;",
  " const three = 3;",
].join("\n");

const file = parsePatchFiles(PATCH).flatMap((parsed) => parsed.files)[0];

function quote(side: "additions" | "deletions", line: number): string | undefined {
  if (file === undefined) throw new Error("the patch did not parse");
  return diffQuote(file, side, line);
}

describe("the text of a commented line", () => {
  test("is the line as the new file numbers it", () => {
    expect([1, 2, 3, 4].map((line) => quote("additions", line))).toEqual([
      "const one = 1;",
      "const two = 22;",
      "const extra = 0;",
      "const three = 3;",
    ]);
  });

  test("is the line as the old file numbered it, for a removed line", () => {
    expect([1, 2, 3].map((line) => quote("deletions", line))).toEqual([
      "const one = 1;",
      "const two = 2;",
      "const three = 3;",
    ]);
  });

  test("is nothing beyond the hunk", () => {
    expect(quote("additions", 5)).toBeUndefined();
    expect(quote("deletions", 4)).toBeUndefined();
  });
});
