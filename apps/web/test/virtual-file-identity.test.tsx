// @vitest-environment jsdom
import type { CodeViewFileItem } from "@pierre/diffs/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ProjectComments } from "../src/comments/project-comments.ts";
import { FileView } from "../src/files/file-view.tsx";
import type { ProjectFiles } from "../src/files/project-files.ts";

const captured = vi.hoisted(() => ({ item: undefined as CodeViewFileItem | undefined }));
vi.mock("@pierre/diffs/react", () => ({
  CodeView: ({
    items,
    options,
  }: {
    items: CodeViewFileItem[];
    options: { onLineNumberClick(props: { lineNumber: number }): void };
  }) => {
    captured.item = items[0];
    return (
      <button type="button" onClick={() => options.onLineNumberClick({ lineNumber: 1 })}>
        Comment in renderer
      </button>
    );
  },
}));
vi.mock("../src/comments/project-comments.ts", () => {
  const threads: never[] = [];
  return { useCommentThreads: () => threads };
});
vi.mock("../src/comments/use-comment-width.ts", () => ({ useCommentWidth: () => undefined }));
afterEach(cleanup);

test("annotations advance the renderer revision without replacing the prepared file object", async () => {
  const text = Array.from({ length: 3001 }, (_, index) => `line ${index}`).join("\n");
  const files = {
    opened: { path: "large.ts" },
    content: { status: "ready", value: { kind: "text", text } },
    subscribe: () => () => {},
  } as unknown as ProjectFiles;
  render(<FileView files={files} comments={{ workspaceId: 1 } as ProjectComments} />);
  const button = await screen.findByRole("button", { name: "Comment in renderer" });
  const first = captured.item;
  fireEvent.click(button);
  expect(captured.item?.file).toBe(first?.file);
  expect(captured.item?.version).not.toBe(first?.version);
  expect(captured.item?.annotations).toHaveLength(1);
});
