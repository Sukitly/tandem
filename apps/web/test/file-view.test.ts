import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { ProjectComments } from "../src/comments/project-comments.ts";
import { FileView } from "../src/files/file-view.tsx";
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
  });
});
