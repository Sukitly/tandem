import type { FileEntry } from "@tandem/contracts";
import { describe, expect, test } from "vitest";
import { isDimmed } from "../src/files/dimmed.ts";
import { isHidden } from "../src/files/hidden.ts";

const file = (name: string): FileEntry => ({ name, path: name, kind: "file" });
const directory = (name: string): FileEntry => ({ name, path: name, kind: "directory" });
const ignored: FileEntry = { name: "dist", path: "dist", kind: "directory", ignored: true };

describe("hidden entries", () => {
  test("identifies VCS metadata and OS metadata as hidden", () => {
    expect(isHidden(".git")).toBe(true);
    expect(isHidden(".DS_Store")).toBe(true);
    expect(isHidden(".svn")).toBe(true);
    expect(isHidden(".hg")).toBe(true);
    expect(isHidden("CVS")).toBe(true);
    expect(isHidden("Thumbs.db")).toBe(true);
    expect(isHidden("._some_file")).toBe(true);
  });

  test("does not treat regular configuration dotfiles as hidden", () => {
    expect(isHidden(".gitignore")).toBe(false);
    expect(isHidden(".editorconfig")).toBe(false);
    expect(isHidden(".env")).toBe(false);
    expect(isHidden(".github")).toBe(false);
    expect(isHidden(".vscode")).toBe(false);
    expect(isHidden("README.md")).toBe(false);
  });
});

describe("dimmed entries", () => {
  test("Git-ignored entries and shown hidden entries are dimmed", () => {
    expect(isDimmed(ignored, false)).toBe(true);
    expect(isDimmed(directory(".git"), false)).toBe(true);
    expect(isDimmed(file(".DS_Store"), false)).toBe(true);
  });

  test("regular configuration dotfiles and untracked files are not dimmed", () => {
    expect(isDimmed(file(".gitignore"), false)).toBe(false);
    expect(isDimmed(file(".editorconfig"), false)).toBe(false);
    expect(isDimmed(file(".env"), false)).toBe(false);
    expect(isDimmed(file("README.md"), false)).toBe(false);
  });

  test("everything below a dimmed directory is dimmed with it", () => {
    expect(isDimmed(file("index.js"), true)).toBe(true);
    expect(isDimmed(file("index.js"), false)).toBe(false);
  });
});
