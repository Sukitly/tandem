// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import type { ToolStatus, TranscriptItem } from "../src/chat/transcript.ts";
import { TranscriptEntry } from "../src/chat/transcript-items.tsx";
import { Terminal, type TerminalProps } from "../src/components/ai-elements/terminal.tsx";
import { Tool } from "../src/components/ai-elements/tool.tsx";

afterEach(cleanup);

function step(kind: "terminal" | "tool", status: TerminalProps["status"]) {
  return kind === "terminal"
    ? createElement(Terminal, { command: "bun run test", status })
    : createElement(Tool, { name: "read", description: "src/app.ts", status });
}

test.each(["terminal", "tool"] as const)("%s uses a spinner while running and its static icon otherwise", (kind) => {
  const { container, rerender } = render(step(kind, "running"));
  const spinner = container.querySelector("[data-slot=trace-icon] .animate-spin");
  expect(spinner?.classList.contains("lucide-loader-circle")).toBe(true);
  expect(spinner?.classList.contains("motion-reduce:animate-none")).toBe(true);
  expect(container.querySelector("[data-slot=trace-title]")?.classList.contains("shimmer-none!")).toBe(true);

  for (const status of ["pending", "done", "error", "failed", "cancelled"] as const) {
    rerender(step(kind, status));
    expect(container.querySelector(".animate-spin")).toBeNull();
    const icon = kind === "terminal" ? ".lucide-terminal" : ".lucide-check";
    expect(container.querySelector(`[data-slot=trace-icon] ${icon}`)).not.toBeNull();
    if (kind === "terminal") expect(container.querySelector(".lucide-check")).toBeNull();
  }
});

test.each(["read", "edit", "write", "reply_to_comment", "new_backend_tool"])(
  "transcript displays the backend name %s verbatim in a badge in every state",
  (name) => {
    function entry(status: ToolStatus) {
      const item: TranscriptItem = {
        kind: "assistant",
        key: "message",
        ending: "streaming",
        parts: [{ kind: "tool", callId: "call", name, args: {}, status, output: "", images: [] }],
      };
      return createElement(TranscriptEntry, { item });
    }
    const { container, rerender } = render(entry("pending"));
    for (const status of ["pending", "running", "done", "failed", "cancelled"] as const) {
      rerender(entry(status));
      expect(container.querySelector("[data-slot=badge]")?.textContent).toBe(name);
      expect(container.querySelectorAll("[data-slot=badge]")).toHaveLength(1);
      const icon = status === "running" ? ".animate-spin" : ".lucide-check";
      expect(container.querySelector(`[data-slot=trace-icon] ${icon}`)).not.toBeNull();
      expect(container.textContent).not.toMatch(/Ran|Running|Read|Reading|Edited|Editing|Wrote|Writing|Called/);
      if (status === "failed" || status === "cancelled") expect(screen.getByText(status)).toBeDefined();
    }
  },
);

test("terminal shows a command title and streaming output without generic tool sections", () => {
  const { container } = render(
    createElement(Terminal, { command: "bun run test", output: "test output", status: "running" }),
  );
  expect(container.querySelector("[data-slot=badge]")).toBeNull();
  expect(screen.queryByText("Input")).toBeNull();
  expect(screen.queryByText("Output")).toBeNull();
  expect(screen.getByText("Running bun run test")).toBeDefined();
  expect(screen.getByText("test output")).toBeDefined();
  const trigger = screen.getByRole("button");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("terminal still displays nonzero exit codes as failures", () => {
  const { container } = render(createElement(Terminal, { command: "false", exitCode: 1, status: "done" }));
  expect(container.querySelector("[data-status=error]")).not.toBeNull();
  expect(screen.getByText("false exited with code 1")).toBeDefined();
});

test.each([
  ["pending", "Run"],
  ["running", "Running"],
  ["done", "Ran"],
  ["failed", "Failed to run"],
  ["error", "Failed to run"],
  ["cancelled", "Cancelled"],
] as const)("terminal describes its %s state without an empty output panel", (status, prefix) => {
  render(step("terminal", status));
  expect(screen.getByText(`${prefix} bun run test`)).toBeDefined();
  expect(screen.queryByRole("button")).toBeNull();
});

test.each(["done", "failed", "cancelled"] as const)("terminal automatically collapses when %s", (status) => {
  function terminal(status: TerminalProps["status"]) {
    return createElement(Terminal, { command: "bun run test", output: "test output", status });
  }
  const { rerender } = render(terminal("pending"));
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
  rerender(terminal("running"));
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
  rerender(terminal(status));
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
});

test("terminal preserves manual collapse and expand choices across status updates", () => {
  function terminal(status: TerminalProps["status"]) {
    return createElement(Terminal, { command: "bun run test", output: "test output", status });
  }
  const { rerender } = render(terminal("running"));
  fireEvent.click(screen.getByRole("button"));
  rerender(terminal("done"));
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
  rerender(terminal("running"));
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button"));
  rerender(terminal("done"));
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
});
