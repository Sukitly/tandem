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
  const input = screen.getByText("Input").parentElement?.querySelector("[data-slot=code-block-content]");
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

test("bash expands directly to output instead of generic tool input and output sections", async () => {
  const { container } = render(entry("bash", { command: "echo hello", timeout: 120 }, "hello"));
  expect(screen.getByText("Ran echo hello")).toBeDefined();
  expect(container.querySelector("[data-slot=badge]")).toBeNull();
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByText("hello")).toBeDefined());
  expect(screen.queryByText("Input")).toBeNull();
  expect(screen.queryByText("Output")).toBeNull();
  expect(container.querySelectorAll("[data-slot=code-block-content]")).toHaveLength(1);
});

test("an empty input is still available as an empty object", async () => {
  render(entry("no_args_tool", {}));
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByText("{}")).toBeDefined());
});
