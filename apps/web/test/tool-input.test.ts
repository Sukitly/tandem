// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import type { TranscriptItem } from "../src/chat/transcript.ts";
import { TranscriptEntry } from "../src/chat/transcript-items.tsx";

afterEach(cleanup);

function entry(name: string, args: Record<string, unknown>, output = "") {
  const item: TranscriptItem = {
    kind: "assistant",
    key: "message",
    ending: "complete",
    parts: [{ kind: "tool", callId: "call", name, args, status: "done", output, images: [] }],
  };
  return createElement(TranscriptEntry, { item });
}

const cases = [
  { name: "bash", args: { command: `${"echo long-command; ".repeat(100)}\nprintf 'done\\n'`, timeout: 120 } },
  { name: "read", args: { path: "src/app.ts", offset: 10, limit: 20 } },
  { name: "edit", args: { path: "src/app.ts", edits: [{ oldText: "old\ntext", newText: "new\ntext" }] } },
  { name: "write", args: { path: "src/new.ts", content: "const message = 'hello';\n".repeat(100) } },
  { name: "reply_to_comment", args: { threadId: 42, text: "A full reply" } },
  { name: "new_backend_tool", args: { options: { values: [1, true, null, "<script>alert(1)</script>"] } } },
];

test.each(cases)("expanding $name shows every input parameter alongside the output", async ({ name, args }) => {
  const { container } = render(entry(name, args, "Tool output"));
  const trigger = screen.getByRole("button");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByText("Input")).toBeDefined());
  const input = screen.getByText("Input").parentElement?.querySelector("[data-slot=code-block-content]");
  expect(JSON.parse(input?.textContent ?? "")).toEqual(args);
  expect(input?.getAttribute("data-wrap")).toBe("true");
  expect(input?.classList.contains("truncate")).toBe(false);
  expect(screen.getByText("Output")).toBeDefined();
  expect(screen.getByText("Tool output")).toBeDefined();
  expect(container.querySelector("script")).toBeNull();
});

test.each(["bash", "new_backend_tool"])("%s input is expandable even without any output", async (name) => {
  render(entry(name, { command: "echo hello", extra: { enabled: true } }));
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByText("Input")).toBeDefined());
  expect(screen.queryByText("Output")).toBeNull();
  expect(screen.getByText(/"enabled": true/)).toBeDefined();
});

test("an empty input is still available as an empty object", async () => {
  render(entry("no_args_tool", {}));
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByText("{}")).toBeDefined());
});
