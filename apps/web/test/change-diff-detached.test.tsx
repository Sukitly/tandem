// @vitest-environment jsdom
import type { CommentThread } from "@tandem/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChangeDiff } from "../src/changes/change-diff.tsx";
import type { ProjectComments } from "../src/comments/project-comments.ts";

const state = vi.hoisted(() => ({ files: { read: vi.fn() }, openFile: vi.fn(), threads: [] as CommentThread[] }));
vi.mock("@pierre/diffs/react", () => ({ CodeView: () => null }));
vi.mock("../src/rpc/connection.tsx", () => ({ useConnected: () => ({ files: state.files }) }));
vi.mock("../src/app/workbench.tsx", () => ({ useWorkbench: () => ({ openFile: state.openFile }) }));
vi.mock("../src/comments/project-comments.ts", () => ({ useCommentThreads: () => state.threads }));
afterEach(cleanup);
beforeEach(() => {
  state.files.read.mockReset();
  state.openFile.mockReset();
  state.threads = [
    { id: 4, workspaceId: 1, anchor: { path: "a.ts", line: 9, quote: "outside", before: [], after: [] }, messages: [] },
  ];
});
function show() {
  render(
    <ChangeDiff
      path="a.ts"
      style="unified"
      comments={{ workspaceId: 1 } as ProjectComments}
      patch={{ kind: "patch", patch: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n" }}
    />,
  );
}
test("a live comment outside the hunks remains visible and opens its relocated position in Files", async () => {
  state.files.read.mockResolvedValue({ kind: "text", text: "new\noutside\n" });
  show();
  await waitFor(() => expect(state.files.read).toHaveBeenCalledOnce());
  expect(screen.getByText("Outside this diff")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Show comment in file" }));
  expect(state.openFile).toHaveBeenCalledWith("a.ts", { line: 2, threadId: 4 });
  expect(screen.queryByText("Outdated")).toBeNull();
});
test("an unreadable file does not incorrectly mark a comment as outdated", async () => {
  state.files.read.mockRejectedValue(new Error("Disconnected"));
  show();
  await waitFor(() => expect(state.files.read).toHaveBeenCalledOnce());
  expect(screen.getByText("Outside this diff")).toBeDefined();
  expect(screen.queryByText("Outdated")).toBeNull();
});
test("a comment confirmed absent from the file is marked outdated", async () => {
  state.files.read.mockResolvedValue({ kind: "text", text: "new\n" });
  show();
  expect(await screen.findByText("Outdated")).toBeDefined();
});
