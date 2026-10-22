// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import type { TranscriptItem } from "../src/chat/transcript.ts";
import { TranscriptEntry } from "../src/chat/transcript-items.tsx";
import { inTranscript } from "./in-transcript.ts";

afterEach(cleanup);

function entry(name: string, args: Record<string, unknown>, output = "") {
  const item: TranscriptItem = {
    kind: "assistant",
    key: "message",
    ending: "complete",
    parts: [{ kind: "tool", callId: "call", name, args, status: "done", output, images: [] }],
  };
  return inTranscript(createElement(TranscriptEntry, { item }));
}

const cases = [
  { name: "read", args: { path: "src/app.ts", offset: 10, limit: 20 } },
  { name: "reply_to_comment", args: { threadId: 42, text: "A full reply" } },
  { name: "new_backend_tool", args: { options: { values: [1, true, null, "<script>alert(1)</script>"] } } },
];

test.each(cases)("expanding $name shows every input parameter alongside the output", async ({ name, args }) => {
  const { container } = render(entry(name, args, "Tool output"));
  const trigger = screen.getByRole("button");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByText("Input")).toBeDefined());
  // "Input" is the title of the block that holds the arguments.
  const input = screen
    .getByText("Input")
    .closest("[data-slot=code-block]")
    ?.querySelector("[data-slot=code-block-content]");
  expect(JSON.parse(input?.textContent ?? "")).toEqual(args);
  expect(input?.getAttribute("data-wrap")).toBe("true");
  expect(input?.classList.contains("truncate")).toBe(false);
  expect(screen.getByText("Output")).toBeDefined();
  expect(screen.getByText("Tool output")).toBeDefined();
  expect(container.querySelector("script")).toBeNull();
});

test("generic tool input is expandable even without any output", async () => {
  render(entry("new_backend_tool", { command: "echo hello", extra: { enabled: true } }));
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByText("Input")).toBeDefined());
  expect(screen.queryByText("Output")).toBeNull();
  expect(screen.getByText(/"enabled": true/)).toBeDefined();
});

test("bash expands to one joined box of command, arguments and output instead of generic tool sections", async () => {
  const { container } = render(entry("bash", { command: "echo hello", timeout: 120 }, "hello"));
  expect(container.querySelector("[data-slot=badge]")?.textContent).toBe("bash");
  expect(screen.getByText("echo hello")).toBeDefined();
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByText("hello")).toBeDefined());
  expect(screen.queryByText("Input")).toBeNull();
  expect(screen.queryByText("Output")).toBeNull();
  // The arguments other than the command are in the command's part, under it; the output is the other part.
  expect(
    Array.from(container.querySelectorAll("[data-slot=code-block-content]"), (block) => block.textContent),
  ).toEqual(["$ echo hellotimeout 120s", "hello"]);
  // The command and its output are two parts of one box, with the divider the style draws between them.
  expect(
    container.querySelector("[data-slot=tool-call-joined]")?.querySelectorAll("[data-slot=code-block]"),
  ).toHaveLength(2);
  // Arguments other than the command stay visible, and the command is not repeated among them.
  expect(container.querySelector("[data-slot=terminal-options]")?.textContent).toBe("timeout 120s");
});

test("an empty input is still available as an empty object", async () => {
  render(entry("no_args_tool", {}));
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByText("{}")).toBeDefined());
});
