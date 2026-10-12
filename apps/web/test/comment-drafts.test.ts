import { beforeEach, describe, expect, test } from "vitest";
import { CommentDrafts, parseComments } from "../src/comments/comment-drafts.ts";

/** A storage that only lives as long as the test. */
class Stored implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }
  clear(): void {
    this.#values.clear();
  }
  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.#values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

const comment = { path: "src/app.ts", line: 42, quote: "const a = 1;", text: "Why one?" };

describe("the comments of a project", () => {
  let storage: Stored;

  beforeEach(() => {
    storage = new Stored();
  });

  test("are numbered by the store, and told apart", () => {
    const drafts = new CommentDrafts(3, storage);
    const first = drafts.add(comment);
    const second = drafts.add({ ...comment, line: 43 });
    expect(first.id).not.toBe(second.id);
    expect(drafts.all.map((written) => written.line)).toEqual([42, 43]);
  });

  test("change, and are dropped", () => {
    const drafts = new CommentDrafts(3, storage);
    const written = drafts.add(comment);
    drafts.update(written.id, "Not one.");
    expect(drafts.all[0]?.text).toBe("Not one.");
    drafts.remove(written.id);
    expect(drafts.all).toEqual([]);
  });

  test("count their changes, so a renderer can see them", () => {
    const drafts = new CommentDrafts(3, storage);
    const before = drafts.revision;
    const written = drafts.add(comment);
    expect(drafts.revision).toBeGreaterThan(before);
    const added = drafts.revision;
    drafts.remove(written.id);
    expect(drafts.revision).toBeGreaterThan(added);
  });

  test("outlive the page they were written on, one project apart from another", () => {
    new CommentDrafts(3, storage).add(comment);
    const again = new CommentDrafts(3, storage);
    expect(again.all).toEqual([{ ...comment, id: expect.any(String) }]);
    expect(new CommentDrafts(4, storage).all).toEqual([]);
  });

  test("are emptied when they are sent", () => {
    const drafts = new CommentDrafts(3, storage);
    drafts.add(comment);
    drafts.clear();
    expect(drafts.all).toEqual([]);
    expect(new CommentDrafts(3, storage).all).toEqual([]);
  });

  test("listen", () => {
    const drafts = new CommentDrafts(3, storage);
    let told = 0;
    const stop = drafts.subscribe(() => (told += 1));
    drafts.add(comment);
    expect(told).toBe(1);
    stop();
    drafts.add(comment);
    expect(told).toBe(1);
  });
});

describe("reading stored comments", () => {
  test("takes what is a comment and leaves out what is not", () => {
    const written = [
      { id: "a", path: "src/app.ts", line: 1, quote: "x", text: "y" },
      { id: "b", path: "src/app.ts", line: 2, side: "deletions", quote: "x", text: "y" },
    ];
    expect(parseComments(JSON.stringify([...written, { id: "c" }, null, 7, { ...written[0], line: "1" }]))).toEqual(
      written,
    );
  });

  test("is nothing for what is unreadable or absent", () => {
    expect(parseComments(null)).toEqual([]);
    expect(parseComments("{")).toEqual([]);
    expect(parseComments('{"id":"a"}')).toEqual([]);
  });
});
