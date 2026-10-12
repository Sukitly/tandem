import type { FileEntry } from "@tandem/contracts";
import { describe, expect, test } from "vitest";
import { isDimmed } from "../src/files/dimmed.ts";

const file = (name: string): FileEntry => ({ name, path: name, kind: "file" });
const ignored: FileEntry = { name: "dist", path: "dist", kind: "directory", ignored: true };

describe("dimmed entries", () => {
  test("hidden (a leading dot) and Git-ignored entries are dimmed", () => {
    expect(isDimmed(file(".gitignore"), false)).toBe(true);
    expect(isDimmed(file(".env"), false)).toBe(true);
    expect(isDimmed(ignored, false)).toBe(true);
    expect(isDimmed(file("README.md"), false)).toBe(false);
  });

  test("everything below a dimmed directory is dimmed with it", () => {
    expect(isDimmed(file("index.js"), true)).toBe(true);
    expect(isDimmed(file("index.js"), false)).toBe(false);
  });
});
