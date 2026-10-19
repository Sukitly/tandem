// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ChatView } from "../src/chat/chat-view.tsx";
import { renderInRouter } from "./in-router.tsx";

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
  return { open };
});
vi.mock("../src/rpc/connection.tsx", () => ({ useConnected: () => ({ open: state.open }) }));
afterEach(() => {
  cleanup();
  state.open.retry.mockClear();
  state.open.failureValue = new Error("Permission denied");
});

test("an opening failure has a retry action that returns to the loading state", async () => {
  await renderInRouter(<ChatView conversationId={7} />, { path: "/c/7" });
  expect(screen.getByRole("alert").textContent).toBe("Permission denied");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(state.open.retry).toHaveBeenCalledWith(7);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Opening the conversation")).toBeTruthy();
});

test("failed conversations can be left without reloading the page", async () => {
  const { router } = await renderInRouter(<ChatView conversationId={7} />, { path: "/c/7" });
  const back = screen.getByRole("link", { name: "Back to workspace" });
  expect(back.getAttribute("href")).toBe("/");
  fireEvent.click(back);
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
});
