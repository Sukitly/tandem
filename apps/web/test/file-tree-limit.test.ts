import type { FileEntry } from "@tandem/contracts";
import { expect, test } from "vitest";
import { DIRECTORY_ENTRY_LIMIT, truncateEntries } from "../src/files/file-tree-limit.ts";

const f = (path: string): FileEntry => ({ path, name: path, kind: "file" });

test("a directory smaller than or equal to the limit is shown in full", () => {
  const entries = [f("a"), f("b")];
  expect(truncateEntries(entries, 5)).toEqual({ shown: entries, remaining: 0 });
  expect(truncateEntries(entries, 2)).toEqual({ shown: entries, remaining: 0 });
  expect(truncateEntries([], 2)).toEqual({ shown: [], remaining: 0 });
});

test("a directory larger than the limit is cut off and reports how many remain", () => {
  const entries = Array.from({ length: 10 }, (_, i) => f(`f-${i}`));
  const truncated = truncateEntries(entries, 4);
  expect(truncated.shown.map((e) => e.name)).toEqual(["f-0", "f-1", "f-2", "f-3"]);
  expect(truncated.remaining).toBe(6);
});

test("default limit is 300 entries", () => {
  const many = Array.from({ length: 350 }, (_, i) => f(`f-${i}`));
  const truncated = truncateEntries(many);
  expect(truncated.shown).toHaveLength(DIRECTORY_ENTRY_LIMIT);
  expect(truncated.remaining).toBe(50);
});
