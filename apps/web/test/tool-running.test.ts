// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { ToolStatus, TranscriptItem } from "../src/chat/transcript.ts";
import { TranscriptEntry } from "../src/chat/transcript-items.tsx";
import { Terminal, type TerminalProps } from "../src/components/ai-elements/terminal.tsx";
import { Tool } from "../src/components/ai-elements/tool.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function step(kind: "terminal" | "tool", status: TerminalProps["status"]) {
  return kind === "terminal"
    ? createElement(Terminal, { name: "bash", command: "bun run test", status })
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

test.each(["bash", "read", "edit", "write", "reply_to_comment", "new_backend_tool"])(
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
      const icon = status === "running" ? ".animate-spin" : name === "bash" ? ".lucide-terminal" : ".lucide-check";
      expect(container.querySelector(`[data-slot=trace-icon] ${icon}`)).not.toBeNull();
      expect(container.textContent).not.toMatch(/Ran|Running|Read|Reading|Edited|Editing|Wrote|Writing|Called/);
      if (status === "failed" || status === "cancelled") expect(screen.getByText(status)).toBeDefined();
    }
  },
);

const title = (container: HTMLElement) => container.querySelector("[data-slot=trace-title]")?.textContent;
const blocks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-slot=code-block-content]"), (block) => block.textContent);

test("terminal keeps the command and streaming output in one block beside the name badge", () => {
  const { container } = render(
    createElement(Terminal, { name: "bash", command: "bun run test", output: "test output", status: "running" }),
  );
  expect(container.querySelector("[data-slot=badge]")?.textContent).toBe("bash");
  expect(screen.queryByText("Input")).toBeNull();
  expect(screen.queryByText("Output")).toBeNull();
  expect(title(container)).toBe("bun run test");
  expect(container.querySelectorAll("[data-slot=code-block]")).toHaveLength(1);
  expect(blocks(container)).toEqual(["$ bun run test", "test output"]);
  // A single divider separates the command from its output.
  const block = container.querySelector("[data-slot=code-block]");
  expect(block?.querySelectorAll("hr")).toHaveLength(1);
  const divider = block?.querySelector("hr");
  expect(divider?.previousElementSibling?.textContent).toBe("$ bun run test");
  expect(divider?.nextElementSibling?.textContent).toBe("test output");
  const trigger = screen.getByRole("button", { name: /bash/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("terminal has no divider until there is output to separate from the command", () => {
  const { container, rerender } = render(
    createElement(Terminal, { name: "bash", command: "bun run test", status: "running" }),
  );
  expect(blocks(container)).toEqual(["$ bun run test"]);
  expect(container.querySelector("hr")).toBeNull();
  rerender(createElement(Terminal, { name: "bash", command: "bun run test", output: "first line", status: "running" }));
  expect(blocks(container)).toEqual(["$ bun run test", "first line"]);
  expect(container.querySelectorAll("hr")).toHaveLength(1);
});

test("terminal shows the call's other arguments with the command, named exactly as the backend did", () => {
  const options = { timeout: 120, cwd: "/tmp/my app", env: { CI: "1" }, background: false, retries: 3 };
  const { container } = render(
    createElement(Terminal, { name: "bash", command: "bun run test", options, output: "out", status: "running" }),
  );
  const row = container.querySelector("[data-slot=terminal-options]");
  // The timeout is in seconds, which the backend states only in its schema, so the unit is added; other numbers are not.
  expect(Array.from(row?.children ?? [], (option) => option.textContent)).toEqual([
    "timeout 120s",
    "cwd /tmp/my app",
    'env {"CI":"1"}',
    "background false",
    "retries 3",
  ]);
  // The arguments belong to the input half: after the command, before the divider.
  const block = container.querySelector("[data-slot=code-block]");
  const hr = block?.querySelector("hr");
  expect(row?.previousElementSibling?.textContent).toBe("$ bun run test");
  expect(row?.nextElementSibling).toBe(hr);
  expect(container.querySelectorAll("[data-slot=code-block]")).toHaveLength(1);
});

test("terminal shows no arguments row when the command is the only argument", () => {
  const { container } = render(
    createElement(Terminal, { name: "bash", command: "ls", options: {}, output: "out", status: "running" }),
  );
  expect(container.querySelector("[data-slot=terminal-options]")).toBeNull();
});

test("terminal shows a nonzero exit code as a failure beside the command", () => {
  const { container } = render(
    createElement(Terminal, { name: "bash", command: "false", exitCode: 1, status: "done" }),
  );
  expect(container.querySelector("[data-status=error]")).not.toBeNull();
  expect(title(container)).toBe("false");
  expect(container.querySelector("[data-slot=trace-description]")?.textContent).toBe("failed (exit 1)");
});

const longCommand = [
  `echo ${"long-argument ".repeat(60)}`,
  "cat <<'EOF' > out.txt",
  "line one",
  "  indented line two",
  "EOF",
  "printf 'done\\n'",
].join("\n");

test("expanding a terminal reveals the complete multi-line command, not just its truncated title", () => {
  const { container } = render(
    createElement(Terminal, { name: "bash", command: longCommand, exitCode: 2, status: "done" }),
  );
  expect(blocks(container)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: /bash/ }));
  expect(blocks(container)).toEqual([`$ ${longCommand}`]);
  expect(container.querySelector("hr")).toBeNull();
  expect(container.querySelector("[data-slot=code-block-content]")?.getAttribute("data-wrap")).toBe("true");
  expect(screen.queryByText("Input")).toBeNull();
  expect(screen.queryByText("Output")).toBeNull();
  // The exit code lives outside the truncated title, so a long command cannot push it out of view.
  const description = container.querySelector("[data-slot=trace-description]");
  expect(description?.textContent).toBe("failed (exit 2)");
  expect(description?.classList.contains("shrink-0")).toBe(true);
  expect(title(container)).toBe(longCommand);
});

test("the command block copies the bare command without its prompt", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(createElement(Terminal, { name: "bash", command: longCommand, output: "out", status: "running" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(longCommand));
});

test.each(["pending", "running", "done", "failed", "error", "cancelled"] as const)(
  "terminal shows the badge and bare command in its %s state and can always be expanded",
  (status) => {
    const { container } = render(step("terminal", status));
    expect(container.querySelector("[data-slot=badge]")?.textContent).toBe("bash");
    expect(title(container)).toBe("bun run test");
    expect(container.textContent).not.toMatch(/Ran|Running|Run /);
    const trigger = screen.getByRole("button", { name: /bash/ });
    expect(trigger.getAttribute("aria-expanded")).toBe(String(status === "running"));
    // The command is the only block until there is output to follow it.
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe(String(status !== "running"));
    if (status !== "running") expect(blocks(container)).toEqual(["$ bun run test"]);
  },
);

test.each(["done", "failed", "cancelled"] as const)("terminal automatically collapses when %s", (status) => {
  function terminal(status: TerminalProps["status"]) {
    return createElement(Terminal, { name: "bash", command: "bun run test", output: "test output", status });
  }
  const { rerender } = render(terminal("pending"));
  expect(screen.getByRole("button", { name: /bash/ }).getAttribute("aria-expanded")).toBe("false");
  rerender(terminal("running"));
  expect(screen.getByRole("button", { name: /bash/ }).getAttribute("aria-expanded")).toBe("true");
  rerender(terminal(status));
  expect(screen.getByRole("button", { name: /bash/ }).getAttribute("aria-expanded")).toBe("false");
});

test("terminal preserves manual collapse and expand choices across status updates", () => {
  function terminal(status: TerminalProps["status"]) {
    return createElement(Terminal, { name: "bash", command: "bun run test", output: "test output", status });
  }
  const { rerender } = render(terminal("running"));
  fireEvent.click(screen.getByRole("button", { name: /bash/ }));
  rerender(terminal("done"));
  expect(screen.getByRole("button", { name: /bash/ }).getAttribute("aria-expanded")).toBe("false");
  rerender(terminal("running"));
  expect(screen.getByRole("button", { name: /bash/ }).getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: /bash/ }));
  rerender(terminal("done"));
  expect(screen.getByRole("button", { name: /bash/ }).getAttribute("aria-expanded")).toBe("true");
});
