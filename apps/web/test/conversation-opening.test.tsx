// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ChatView } from "../src/chat/chat-view.tsx";

const state = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const open = {
    failureValue: new Error("Permission denied") as Error | undefined,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => undefined,
    failure: () => open.failureValue,
    hold: () => () => {},
    retry: vi.fn(() => {
      open.failureValue = undefined;
      for (const listener of listeners) listener();
    }),
  };
  return { open, select: vi.fn() };
});
vi.mock("../src/rpc/connection.tsx", () => ({ useConnected: () => ({ open: state.open }) }));
vi.mock("../src/app/workbench.tsx", () => ({ useWorkbench: () => ({ select: state.select }) }));
afterEach(() => {
  cleanup();
  state.open.retry.mockClear();
  state.open.failureValue = new Error("Permission denied");
  state.select.mockClear();
});

test("an opening failure has a retry action that returns to the loading state", () => {
  render(<ChatView conversationId={7} />);
  expect(screen.getByRole("alert").textContent).toBe("Permission denied");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(state.open.retry).toHaveBeenCalledWith(7);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Opening the conversation")).toBeTruthy();
});

test("failed conversations can be left without reloading the page", () => {
  render(<ChatView conversationId={7} />);
  fireEvent.click(screen.getByRole("button", { name: "Back to workspace" }));
  expect(state.select).toHaveBeenCalledWith(null);
});
