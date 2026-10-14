import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { ProjectComments } from "../src/comments/project-comments.ts";
import { countLines, FileView, formatLines } from "../src/files/file-view.tsx";
import type { ProjectFiles } from "../src/files/project-files.ts";

vi.mock("../src/files/project-files.ts", () => ({
  useProjectFiles: (_files: unknown, select: (f: unknown) => unknown) =>
    select({
      opened: { path: "src/main.ts" },
      content: { status: "ready", value: { kind: "text", text: "console.log(1);\n", size: 16 } },
    }),
}));

vi.mock("../src/chat/highlight.tsx", () => ({
  languageOfFile: () => undefined,
  useHighlighted: () => undefined,
  HighlightedLine: () => null,
}));

vi.mock("../src/comments/project-comments.ts", () => ({
  useCommentThreads: () => [],
}));

describe("FileView zoom toggle button", () => {
  test("shows full screen zoom button when a file is opened", () => {
    const markup = renderToStaticMarkup(
      createElement(FileView, {
        files: {} as ProjectFiles,
        comments: {} as ProjectComments,
      }),
    );
    expect(markup).toContain('aria-label="Full screen"');
    expect(markup).toContain('aria-label="Close the file"');
    expect(markup).toContain("src/main.ts");
    expect(markup).toContain("1 L");
    expect(markup).not.toContain("16 B");
  });
});

describe("countLines and formatLines", () => {
  test("counts lines in text files accurately", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("\n")).toBe(1);
    expect(countLines("console.log(1);")).toBe(1);
    expect(countLines("console.log(1);\n")).toBe(1);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\n\n")).toBe(2);
  });

  test("formats line count for display", () => {
    expect(formatLines(0)).toBe("0 L");
    expect(formatLines(1)).toBe("1 L");
    expect(formatLines(2)).toBe("2 L");
    expect(formatLines(1000)).toBe("1,000 L");
  });
});
