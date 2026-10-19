// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { TranscriptItem } from "../src/chat/transcript.ts";
import { TranscriptEntry } from "../src/chat/transcript-items.tsx";

const shown = vi.hoisted(() => ({ patch: undefined as string | undefined, file: undefined as unknown }));
vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: ({ patch }: { patch: string }) => {
    shown.patch = patch;
    return <div data-testid="patch">{patch}</div>;
  },
  File: ({ file }: { file: { name: string; contents: string } }) => {
    shown.file = file;
    return <div data-testid="file">{file.contents}</div>;
  },
}));

afterEach(() => {
  cleanup();
  shown.patch = undefined;
  shown.file = undefined;
});

type Step = Extract<Extract<TranscriptItem, { kind: "assistant" }>["parts"][number], { kind: "tool" }>;

function entry(step: Partial<Step> & Pick<Step, "name" | "args">) {
  const item: TranscriptItem = {
    kind: "assistant",
    key: "message",
    ending: "complete",
    parts: [{ kind: "tool", callId: "call", status: "done", output: "", images: [], ...step }],
  };
  return createElement(TranscriptEntry, { item });
}

const patch = "--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new\n";

test("an edit expands to its patch, not to its arguments as JSON", () => {
  const args = { path: "a.ts", edits: [{ oldText: "old", newText: "new" }] };
  render(entry({ name: "edit", args, output: "Successfully replaced 1 block(s) in a.ts.", patch }));
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByTestId("patch").textContent).toBe(patch);
  expect(screen.queryByText("Input")).toBeNull();
  expect(screen.queryByText("Output")).toBeNull();
  expect(screen.queryByText(/oldText/)).toBeNull();
  expect(screen.queryByText(/Successfully replaced/)).toBeNull();
});

test("a write expands to the content it wrote, named for the file, not to its arguments as JSON", () => {
  const content = "const message = 'hello';\n";
  render(entry({ name: "write", args: { path: "src/new.ts", content }, output: "Successfully wrote to src/new.ts" }));
  fireEvent.click(screen.getByRole("button"));
  expect(shown.file).toEqual({ name: "src/new.ts", contents: content });
  expect(screen.getByTestId("file").textContent).toBe(content);
  expect(screen.queryByText("Input")).toBeNull();
  expect(screen.queryByText("Output")).toBeNull();
  expect(screen.queryByText(/"content"/)).toBeNull();
  expect(screen.queryByText(/Successfully wrote/)).toBeNull();
});

test("a failed edit shows its error, and a failed write shows its error under the content", () => {
  const { unmount } = render(
    entry({ name: "edit", args: { path: "a.ts" }, status: "failed", output: "Could not find the text in a.ts." }),
  );
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("Could not find the text in a.ts.")).toBeDefined();
  expect(screen.queryByTestId("patch")).toBeNull();
  unmount();

  render(
    entry({
      name: "write",
      args: { path: "a.ts", content: "x\n" },
      status: "failed",
      output: "Could not write file: a.ts.",
    }),
  );
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByTestId("file")).toBeDefined();
  expect(screen.getByText("Could not write file: a.ts.")).toBeDefined();
});

test("a call with nothing to show yet is a plain line, not an expandable one", () => {
  render(entry({ name: "edit", args: { path: "a.ts" }, status: "pending" }));
  expect(screen.queryByRole("button")).toBeNull();
});
