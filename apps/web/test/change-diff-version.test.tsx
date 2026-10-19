// @vitest-environment jsdom
import type { CodeViewDiffItem } from "@pierre/diffs/react";
import { afterEach, expect, test, vi } from "vitest";
import { ChangeDiff } from "../src/changes/change-diff.tsx";
import type { ProjectComments } from "../src/comments/project-comments.ts";
import { cleanup, render } from "./render.tsx";

const captured = vi.hoisted(() => ({ items: [] as CodeViewDiffItem[] }));
vi.mock("@pierre/diffs/react", () => ({
  CodeView: ({ items }: { items: CodeViewDiffItem[] }) => {
    captured.items = items;
    return null;
  },
}));
vi.mock("../src/theme.tsx", () => ({ useTheme: () => ({ choice: "light" }) }));
vi.mock("../src/rpc/connection.tsx", () => ({ useConnected: () => ({ files: {} }) }));
vi.mock("../src/comments/project-comments.ts", () => {
  const threads: never[] = [];
  return { useCommentThreads: () => threads };
});
vi.mock("../src/app/workbench.tsx", async () =>
  (await import("./workbench-mock.ts")).workbenchMock(() => ({ openFile: vi.fn() })),
);
afterEach(cleanup);
const patch = (value: string) => `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+${value}\n`;

test("equal-length and different-length patches advance the renderer version without replacing item identity", () => {
  const props = { path: "a.ts", style: "unified" as const, comments: { workspaceId: 1 } as ProjectComments };
  const { rerender } = render(<ChangeDiff {...props} patch={{ kind: "patch", patch: patch("one") }} />);
  const first = captured.items[0];
  rerender(<ChangeDiff {...props} patch={{ kind: "patch", patch: patch("two") }} />);
  const second = captured.items[0];
  expect(second?.id).toBe(first?.id);
  expect(second?.version).not.toBe(first?.version);
  expect(second?.fileDiff).not.toEqual(first?.fileDiff);
  rerender(<ChangeDiff {...props} patch={{ kind: "patch", patch: patch("longer") }} />);
  expect(captured.items[0]?.id).toBe(first?.id);
  expect(captured.items[0]?.version).not.toBe(second?.version);
  const last = captured.items[0]?.version;
  rerender(<ChangeDiff {...props} patch={{ kind: "patch", patch: patch("longer") }} />);
  expect(captured.items[0]?.version).toBe(last);
});
