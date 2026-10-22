// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { AssistantPart, ToolStatus, TranscriptItem } from "../src/chat/transcript.ts";
import { TranscriptEntry } from "../src/chat/transcript-items.tsx";
import { inTranscript } from "./in-transcript.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type ToolPart = Extract<AssistantPart, { kind: "tool" }>;

function entry(...parts: AssistantPart[]) {
  const item: TranscriptItem = { kind: "assistant", key: "message", ending: "streaming", parts };
  return inTranscript(createElement(TranscriptEntry, { item }));
}

function tool(over: Partial<ToolPart> = {}): ToolPart {
  return { kind: "tool", callId: "call", name: "read", args: {}, status: "done", output: "", images: [], ...over };
}

function bash(over: Partial<ToolPart> = {}) {
  return entry(tool({ name: "bash", args: { command: "bun run test" }, status: "running", ...over }));
}

const STATUSES = ["pending", "running", "done", "failed", "cancelled"] as const satisfies readonly ToolStatus[];

test.each(["bash", "read", "edit", "write", "reply_to_comment", "new_backend_tool"])(
  "transcript displays the backend name %s verbatim in a badge in every state",
  (name) => {
    const { container, rerender } = render(entry(tool({ name, status: "pending" })));
    for (const status of STATUSES) {
      rerender(entry(tool({ name, status })));
      expect(container.querySelector("[data-slot=badge]")?.textContent).toBe(name);
      expect(container.querySelectorAll("[data-slot=badge]")).toHaveLength(1);
      expect(container.textContent).not.toMatch(/Ran|Running|Read|Reading|Edited|Editing|Wrote|Writing|Called/);
      if (status === "failed" || status === "cancelled") expect(screen.getByText(status)).toBeDefined();
    }
  },
);

const title = (container: HTMLElement) => container.querySelector("[data-slot=trace-title]")?.textContent;
const blocks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-slot=code-block-content]"), (block) => block.textContent);

test("a command keeps itself and its streaming output in one joined box beside the name badge", () => {
  const { container } = render(bash({ output: "test output" }));
  expect(container.querySelector("[data-slot=badge]")?.textContent).toBe("bash");
  expect(screen.queryByText("Input")).toBeNull();
  expect(screen.queryByText("Output")).toBeNull();
  expect(title(container)).toBe("bun run test");
  // One box, in two parts the style divides: the command first, then what it printed.
  const joined = container.querySelector("[data-slot=tool-call-joined]");
  expect(joined?.querySelectorAll("[data-slot=code-block]")).toHaveLength(2);
  expect(blocks(container)).toEqual(["$ bun run test", "test output"]);
  const trigger = screen.getByRole("button", { name: /bash/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("a command has no output part until there is output", () => {
  const { container, rerender } = render(bash());
  expect(blocks(container)).toEqual(["$ bun run test"]);
  expect(container.querySelectorAll("[data-slot=code-block]")).toHaveLength(1);
  rerender(bash({ output: "first line" }));
  expect(blocks(container)).toEqual(["$ bun run test", "first line"]);
  expect(container.querySelectorAll("[data-slot=code-block]")).toHaveLength(2);
});

test("a command shows the call's other arguments with it, named exactly as the backend did", () => {
  const options = { timeout: 120, cwd: "/tmp/my app", env: { CI: "1" }, background: false, retries: 3 };
  const { container } = render(bash({ args: { command: "bun run test", ...options }, output: "out" }));
  const row = container.querySelector("[data-slot=terminal-options]");
  // The timeout is in seconds, which the backend states only in its schema, so the unit is added; other numbers are not.
  expect(Array.from(row?.children ?? [], (option) => option.textContent)).toEqual([
    "timeout 120s",
    "cwd /tmp/my app",
    'env {"CI":"1"}',
    "background false",
    "retries 3",
  ]);
  // The arguments belong to the part of the command: right after it, in the same box, before the output's.
  expect(row?.previousElementSibling?.textContent).toBe("$ bun run test");
  expect(blocks(container)).toHaveLength(2);
  expect(row?.closest("[data-slot=code-block]")).toBe(container.querySelector("[data-slot=code-block]"));
});

test("a command shows no arguments row when the command is the only argument", () => {
  const { container } = render(bash({ args: { command: "ls" }, output: "out" }));
  expect(container.querySelector("[data-slot=terminal-options]")).toBeNull();
});

test("a failed command shows the word failed beside the command", () => {
  const { container } = render(bash({ args: { command: "false" }, status: "failed" }));
  expect(container.querySelector("[data-status=error]")).not.toBeNull();
  expect(title(container)).toBe("false");
  expect(container.querySelector("[data-slot=trace-description]")?.textContent).toBe("failed");
});

const longCommand = [
  `echo ${"long-argument ".repeat(60)}`,
  "cat <<'EOF' > out.txt",
  "line one",
  "  indented line two",
  "EOF",
  "printf 'done\\n'",
].join("\n");

test("expanding a command reveals the complete multi-line command, not just its truncated title", () => {
  const { container } = render(bash({ args: { command: longCommand }, status: "failed" }));
  expect(blocks(container)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: /bash/ }));
  expect(blocks(container)).toEqual([`$ ${longCommand}`]);
  expect(container.querySelectorAll("[data-slot=code-block]")).toHaveLength(1);
  expect(container.querySelector("[data-slot=code-block-content]")?.getAttribute("data-wrap")).toBe("true");
  expect(screen.queryByText("Input")).toBeNull();
  expect(screen.queryByText("Output")).toBeNull();
  // The status word lives outside the truncated title, so a long command cannot push it out of view.
  expect(container.querySelector("[data-slot=trace-description]")?.textContent).toBe("failed");
  expect(title(container)).toBe(longCommand);
});

test("the command's copy button copies the bare command without its prompt", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(bash({ args: { command: longCommand }, output: "out" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(longCommand));
});

test.each(STATUSES)(
  "a command shows the badge and bare command in its %s state and can always be expanded",
  (status) => {
    const { container } = render(bash({ status }));
    expect(container.querySelector("[data-slot=badge]")?.textContent).toBe("bash");
    expect(title(container)).toBe("bun run test");
    expect(container.textContent).not.toMatch(/Ran|Running|Run /);
    const trigger = screen.getByRole("button", { name: /bash/ });
    expect(trigger.getAttribute("aria-expanded")).toBe(String(status === "running"));
    // The command is the only part until there is output to follow it.
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe(String(status !== "running"));
    if (status !== "running") expect(blocks(container)).toEqual(["$ bun run test"]);
  },
);

test.each(["done", "failed", "cancelled"] as const)("a command automatically collapses when %s", (status) => {
  const command = (status: ToolStatus) => bash({ output: "test output", status });
  const { rerender } = render(command("pending"));
  expect(screen.getByRole("button", { name: /bash/ }).getAttribute("aria-expanded")).toBe("false");
  rerender(command("running"));
  expect(screen.getByRole("button", { name: /bash/ }).getAttribute("aria-expanded")).toBe("true");
  rerender(command(status));
  expect(screen.getByRole("button", { name: /bash/ }).getAttribute("aria-expanded")).toBe("false");
});

test("a command preserves manual collapse and expand choices across status updates", () => {
  const command = (status: ToolStatus) => bash({ output: "test output", status });
  const { rerender } = render(command("running"));
  fireEvent.click(screen.getByRole("button", { name: /bash/ }));
  rerender(command("done"));
  expect(screen.getByRole("button", { name: /bash/ }).getAttribute("aria-expanded")).toBe("false");
  rerender(command("running"));
  expect(screen.getByRole("button", { name: /bash/ }).getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: /bash/ }));
  rerender(command("done"));
  expect(screen.getByRole("button", { name: /bash/ }).getAttribute("aria-expanded")).toBe("true");
});

// The code panel draws each line of its own, so the text it shows has no line breaks; the copy button's text has them.
const argumentsAsDrawn = JSON.stringify({ query: "tandem" }, null, 2).replaceAll("\n", "");

test("any other tool opens to its arguments as JSON and what it returned, each under its name", () => {
  const { container } = render(
    entry(tool({ name: "search", args: { query: "tandem" }, output: "3 results", status: "done" })),
  );
  expect(title(container)).toBe('{"query":"tandem"}');
  expect(blocks(container)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: /search/ }));
  expect(blocks(container)).toEqual([argumentsAsDrawn, "3 results"]);
  expect(screen.getByText("Input")).toBeDefined();
  expect(screen.getByText("Output")).toBeDefined();
});

test("any other tool with nothing returned shows only its arguments", () => {
  const { container } = render(entry(tool({ name: "search", args: { query: "tandem" }, status: "running" })));
  expect(blocks(container)).toEqual([argumentsAsDrawn]);
  expect(screen.getByText("Input")).toBeDefined();
  expect(screen.queryByText("Output")).toBeNull();
});

test("a file change that has nothing to show yet is a line that cannot be opened", () => {
  render(entry(tool({ name: "edit", args: { path: "src/app.ts" }, status: "running" })));
  expect(screen.queryByRole("button", { name: /edit/ })).toBeNull();
  expect(screen.getByText("src/app.ts")).toBeDefined();
});

test("a thinking step is open and named Thinking while it streams, then a closed Thought", () => {
  const thinking = (streaming: boolean) =>
    inTranscript(
      createElement(TranscriptEntry, {
        item: {
          kind: "assistant",
          key: "message",
          ending: streaming ? "streaming" : "complete",
          parts: [{ kind: "thinking", text: "weighing the options" }],
        },
      }),
    );
  const { container, rerender } = render(thinking(true));
  const trigger = () => screen.getByRole("button", { name: /Thinking|Thought/ });
  expect(trigger().textContent).toBe("Thinking");
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("weighing the options");
  rerender(thinking(false));
  expect(trigger().textContent).toBe("Thought");
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

test("a thinking step keeps the reader's choice once it is done", () => {
  const thinking = (ending: "streaming" | "complete") =>
    inTranscript(
      createElement(TranscriptEntry, {
        item: {
          kind: "assistant",
          key: "message",
          ending,
          parts: [{ kind: "thinking", text: "weighing the options" }],
        },
      }),
    );
  const { rerender } = render(thinking("streaming"));
  fireEvent.click(screen.getByRole("button", { name: /Thinking/ }));
  rerender(thinking("complete"));
  expect(screen.getByRole("button", { name: /Thought/ }).getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: /Thought/ }));
  expect(screen.getByRole("button", { name: /Thought/ }).getAttribute("aria-expanded")).toBe("true");
});
