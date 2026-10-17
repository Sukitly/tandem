import type { FileContent, FileEntry, Files } from "@tandem/contracts";
import { describe, expect, test } from "vitest";
import { ProjectFiles } from "../src/files/project-files.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup() {
  const reads: ReturnType<typeof deferred<FileContent>>[] = [];
  const lists: ReturnType<typeof deferred<FileEntry[]>>[] = [];
  const service = {
    read: () => {
      const next = deferred<FileContent>();
      reads.push(next);
      return next.promise;
    },
    list: () => {
      const next = deferred<FileEntry[]>();
      lists.push(next);
      return next.promise;
    },
  } as unknown as Files;
  return { files: new ProjectFiles(service, 1), reads, lists };
}
const content = (text: string): FileContent => ({ kind: "text", text, size: text.length });

describe("file request ordering", () => {
  test.each([false, true])("ignores a superseded read (failure: %s)", async (failure) => {
    const { files, reads } = setup();
    files.open("a.ts");
    files.refresh();
    reads[1]?.resolve(content("new"));
    await Promise.resolve();
    if (failure) reads[0]?.reject(new Error("stale failure"));
    else reads[0]?.resolve(content("old"));
    await Promise.resolve();
    expect(files.content).toEqual({ status: "ready", value: content("new") });
  });

  test("does not reuse a request from before closing and reopening the same path", async () => {
    const { files, reads } = setup();
    files.open("a.ts");
    files.close();
    files.open("a.ts");
    reads[0]?.resolve(content("old"));
    await Promise.resolve();
    expect(files.content).toEqual({ status: "loading" });
    reads[1]?.resolve(content("new"));
    await Promise.resolve();
    expect(files.content).toEqual({ status: "ready", value: content("new") });
  });

  test.each([false, true])("ignores a superseded directory listing (failure: %s)", async (failure) => {
    const { files, lists } = setup();
    files.load("");
    files.refresh();
    lists[1]?.resolve([]);
    await Promise.resolve();
    if (failure) lists[0]?.reject(new Error("stale failure"));
    else lists[0]?.resolve([{ name: "old.ts", kind: "file" } as FileEntry]);
    await Promise.resolve();
    expect(files.directory("")).toEqual({ status: "ready", value: [] });
    expect(files.failure).toBeNull();
  });

  test("invalidates pending listings of collapsed directories during refresh", async () => {
    const { files, lists } = setup();
    files.load("src");
    files.refresh();
    lists[0]?.resolve([]);
    await Promise.resolve();
    expect(files.directory("src")).toBeUndefined();
    files.load("src");
    expect(lists).toHaveLength(2);
  });
});
