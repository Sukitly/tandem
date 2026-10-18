// @vitest-environment jsdom
import type { CommentThread } from "@tandem/contracts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChangeDiff } from "../src/changes/change-diff.tsx";
import type { ProjectComments } from "../src/comments/project-comments.ts";
import { act, cleanup, fireEvent, render, screen, waitFor } from "./render.tsx";

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
  return render(
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
  expect(await screen.findByText("Outside this diff")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Show comment in file" }));
  expect(state.openFile).toHaveBeenCalledWith("a.ts", { line: 2, threadId: 4 });
  expect(screen.queryByText("Outdated")).toBeNull();
});
test("an unreadable file does not incorrectly mark a comment as outdated", async () => {
  state.files.read.mockRejectedValue(new Error("Disconnected"));
  show();
  expect((await screen.findByRole("alert")).textContent).toContain("Disconnected");
  expect(screen.getByText("Location not verified")).toBeDefined();
  expect(screen.queryByText("Outside this diff")).toBeNull();
  expect(screen.queryByText("Outdated")).toBeNull();
  state.files.read.mockResolvedValue({ kind: "text", text: "new\noutside\n" });
  fireEvent.click(screen.getByRole("button", { name: "Retry location check" }));
  expect(await screen.findByText("Outside this diff")).toBeDefined();
  expect(screen.queryByRole("alert")).toBeNull();
});
test("loading is unverified until a file read proves the location", async () => {
  let finish!: (value: { kind: string; text: string }) => void;
  state.files.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show();
  expect(screen.getByText("Location not verified")).toBeDefined();
  expect(screen.queryByText("Outside this diff")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Checking");
  await act(async () => finish({ kind: "text", text: "new\noutside\n" }));
  expect(await screen.findByText("Outside this diff")).toBeDefined();
});

test("missing old-side context cannot prove that a comment is outdated", () => {
  state.threads = state.threads.map((thread) => ({ ...thread, anchor: { ...thread.anchor, side: "deletions" } }));
  show();
  expect(screen.getByText("Location not verified")).toBeDefined();
  expect(screen.queryByText("Outdated")).toBeNull();
  expect(screen.queryByRole("button", { name: "Show comment in file" })).toBeNull();
  expect(state.files.read).not.toHaveBeenCalled();
});

test("a response from an older patch cannot overwrite the current verification", async () => {
  let finish!: (value: { kind: string; text: string }) => void;
  state.files.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  state.files.read.mockResolvedValue({ kind: "text", text: "updated\ncontext\noutside\n" });
  const view = show();
  view.rerender(
    <ChangeDiff
      path="a.ts"
      style="unified"
      comments={{ workspaceId: 1 } as ProjectComments}
      patch={{
        kind: "patch",
        patch: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+updated\n",
      }}
    />,
  );
  await waitFor(() => expect(state.files.read).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Outside this diff")).toBeDefined();
  await act(async () => finish({ kind: "text", text: "no matching line\n" }));
  expect(screen.queryByText("Outdated")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show comment in file" }));
  expect(state.openFile).toHaveBeenCalledWith("a.ts", { line: 3, threadId: 4 });
});

test.each(["binary", "tooLarge"])("a %s file is unverified, not outside or outdated", async (kind) => {
  state.files.read.mockResolvedValue({ kind });
  show();
  expect(await screen.findByRole("alert")).toBeDefined();
  expect(screen.getByText("Location not verified")).toBeDefined();
  expect(screen.queryByText("Outside this diff")).toBeNull();
  expect(screen.queryByText("Outdated")).toBeNull();
});

test("a comment confirmed absent from the file is marked outdated", async () => {
  state.files.read.mockResolvedValue({ kind: "text", text: "new\n" });
  show();
  expect(await screen.findByText("Outdated")).toBeDefined();
});
