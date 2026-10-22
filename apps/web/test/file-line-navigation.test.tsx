// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ProjectComments } from "../src/comments/project-comments.ts";
import { FileView } from "../src/files/file-view.tsx";
import type { ProjectFiles } from "../src/files/project-files.ts";

vi.mock("../src/files/project-files.ts", () => ({
  useProjectFiles: (_files: unknown, select: (value: unknown) => unknown) =>
    select({
      opened: { path: "file.txt" },
      content: { status: "ready", value: { kind: "text", text: "line\n".repeat(1000) } },
    }),
}));
vi.mock("../src/hooks/use-highlighted-code.ts", () => ({
  useHighlightedCode: (code: string) => code.split("\n"),
}));
vi.mock("../src/comments/project-comments.ts", () => ({ useCommentThreads: () => [] }));
afterEach(cleanup);

test("a file contributes one line-number Tab stop, with arrow and endpoint navigation", () => {
  const { container } = render(<FileView files={{} as ProjectFiles} comments={{} as ProjectComments} />);
  // Query the line controls directly: accessible-name queries over thousands of nodes dominate jsdom runtime.
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-line] > button"));
  expect(buttons).toHaveLength(1000);
  expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
  const first = buttons[0];
  if (first === undefined) throw new Error("Missing line control");
  expect(first.getAttribute("aria-label")).toBe("Comment on line 1");
  act(() => first.focus());
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement).toBe(buttons[1]);
  fireEvent.keyDown(document.activeElement as Element, { key: "End" });
  expect(document.activeElement).toBe(buttons.at(-1));
  fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
  expect(document.activeElement).toBe(first);
  expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
});
