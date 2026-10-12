// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ChatComposer } from "../src/chat/chat-composer.tsx";
import type { QueuedMessage } from "../src/chat/transcript.ts";

vi.mock("../src/app/workbench.tsx", () => ({
  useWorkbench: () => ({ openChange: vi.fn() }),
}));

afterEach(cleanup);

// jsdom does not lay out text; check the wrapping utilities on the rendered components.
describe("queued chat messages", () => {
  test.each(["steer", "followUp"] as const)("keeps long %s messages wrappable without truncation", (mode) => {
    const text = `${"A long queued message. ".repeat(30)}\n${"src/".repeat(100)}file.ts\nLast line`;
    const { container } = render(
      createElement(ChatComposer, {
        busy: true,
        queued: [{ id: 1, mode, text }],
        onSend: vi.fn(),
        onStop: vi.fn(),
      }),
    );
    const queue = screen.getByRole("list", { name: "Queued messages" });
    expect(within(queue).getByText(mode === "steer" ? "Steering" : "Follow-up")).toBeDefined();
    const description = queue.querySelector('[data-slot="item-description"]');
    expect(description?.textContent).toBe(text);
    expect(description?.classList.contains("whitespace-pre-wrap")).toBe(true);
    expect(description?.classList.contains("wrap-anywhere")).toBe(true);
    expect(description?.classList.contains("line-clamp-none")).toBe(true);
    expect(description?.classList.contains("line-clamp-2")).toBe(false);
    expect(description?.classList.contains("truncate")).toBe(false);
    expect(description?.parentElement?.classList.contains("min-w-0")).toBe(true);
    expect(container.firstElementChild?.classList.contains("min-w-0")).toBe(true);
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDefined();
  });

  test("updates the queue without retaining messages already consumed by the agent", () => {
    const props = { busy: true, onSend: vi.fn(), onStop: vi.fn() };
    const queued: QueuedMessage[] = [
      { id: 1, mode: "steer", text: "First message" },
      { id: 2, mode: "followUp", text: "Second message" },
    ];
    const { rerender } = render(createElement(ChatComposer, { ...props, queued }));
    expect(screen.getByText("First message")).toBeDefined();
    expect(screen.getByText("Second message")).toBeDefined();
    rerender(createElement(ChatComposer, { ...props, queued: queued.slice(1) }));
    expect(screen.queryByText("First message")).toBeNull();
    expect(screen.getByText("Second message")).toBeDefined();
    rerender(createElement(ChatComposer, { ...props, queued: [] }));
    expect(screen.queryByRole("list", { name: "Queued messages" })).toBeNull();
  });
});
