import { expect, test } from "vitest";
import { anchorAt } from "../src/comments/comment-anchor.ts";
import { CommentDrafts, type DraftLines, locateDraft } from "../src/comments/comment-drafts.ts";

const snapshot = (lines: string[]): DraftLines => ({
  additions: new Map(lines.map((text, index) => [index + 1, text])),
});
test("draft identity and original context survive line insertion and replacement at the old number", () => {
  const store = new CommentDrafts();
  const before = snapshot(["a", "target", "b"]);
  const record = store.create(
    1,
    anchorAt({ path: "a.ts", line: 2 }, (line) => before.additions?.get(line)),
    { kind: "file", snapshot: before },
  );
  record.text.setText("Unsent note");
  expect(locateDraft(record, snapshot(["new", "a", "target", "b"]))).toBe(3);
  expect(locateDraft(record, snapshot(["a", "replacement", "b"]))).toBeUndefined();
  expect(record.anchor.line).toBe(2);
  expect(record.text.getSnapshot().text).toBe("Unsent note");
  expect(store.getSnapshot()[0]).toBe(record);
});
test("ambiguous context is not resolved by old line number or distance", () => {
  const store = new CommentDrafts();
  const before = snapshot(["a", "target", "b"]);
  const record = store.create(
    1,
    anchorAt({ path: "a.ts", line: 2 }, (line) => before.additions?.get(line)),
    { kind: "diff", snapshot: before },
  );
  expect(locateDraft(record, before)).toBe(2);
  expect(locateDraft(record, snapshot(["a", "target", "b", "a", "target", "b"]))).toBeUndefined();
  expect(locateDraft(record, {})).toBeUndefined();
});
test("removed-side drafts cannot migrate to the working file, and sparse lines stay sparse", () => {
  const store = new CommentDrafts();
  const before: DraftLines = { deletions: new Map([[1_000_000_000, "removed"]]) };
  const record = store.create(
    1,
    anchorAt({ path: "a.ts", side: "deletions", line: 1_000_000_000 }, (line) => before.deletions?.get(line)),
    { kind: "diff", snapshot: before },
  );
  expect(locateDraft(record, { additions: before.deletions })).toBeUndefined();
  expect(locateDraft(record, { deletions: new Map([[999_999_999, "removed"]]) })).toBe(999_999_999);
  store.forget(record);
  record.text.setText("Cannot revive");
  expect(record.text.getSnapshot().text).toBe("");
  expect(store.getSnapshot()).toEqual([]);
});
test("disposing the registry is terminal", () => {
  const store = new CommentDrafts();
  store.dispose();
  expect(() =>
    store.create(
      1,
      anchorAt({ path: "a.ts", line: 1 }, () => "a"),
      { kind: "file", snapshot: {} },
    ),
  ).toThrow("disposed");
});
