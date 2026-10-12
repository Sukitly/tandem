import { describe, expect, test } from "vitest";
import { parseFileLink, projectPath } from "../src/files/file-link.ts";

describe("file links", () => {
  test("a path, with a line written as GitHub or compilers do", () => {
    expect(parseFileLink("src/app.ts")).toEqual({ path: "src/app.ts" });
    expect(parseFileLink("src/app.ts#L12")).toEqual({ path: "src/app.ts", line: 12 });
    expect(parseFileLink("src/app.ts#L12-L20")).toEqual({ path: "src/app.ts", line: 12 });
    expect(parseFileLink("src/app.ts:12")).toEqual({ path: "src/app.ts", line: 12 });
    expect(parseFileLink("app.ts:12:5")).toEqual({ path: "app.ts", line: 12 });
    expect(parseFileLink("README.md#usage")).toEqual({ path: "README.md" });
    expect(parseFileLink("my%20notes.md")).toEqual({ path: "my notes.md" });
    expect(parseFileLink("/Users/me/project/a.ts#L3")).toEqual({ path: "/Users/me/project/a.ts", line: 3 });
  });

  test("anything else is not a file", () => {
    for (const href of [
      "https://example.com/a.ts",
      "javascript:alert(1)",
      "vscode://file/a.ts",
      "#usage",
      "a.ts?x=1",
      "//host/a",
      "%E0%A4%A",
    ]) {
      expect(parseFileLink(href)).toBeUndefined();
    }
  });

  test("paths are taken from the project's directory; absolute ones only inside it", () => {
    expect(projectPath("src/app.ts", "/p")).toBe("src/app.ts");
    expect(projectPath("./src/app.ts", "/p")).toBe("src/app.ts");
    expect(projectPath("/p/src/app.ts", "/p")).toBe("src/app.ts");
    expect(projectPath("/p", "/p")).toBe("");
    expect(projectPath("/pq/app.ts", "/p")).toBeUndefined();
    expect(projectPath("/etc/passwd", "/p")).toBeUndefined();
  });
});
