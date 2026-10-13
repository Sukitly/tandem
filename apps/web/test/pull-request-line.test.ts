// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { PullRequestLine } from "../src/chat/pull-request-line.tsx";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn().mockResolvedValue(undefined),
  state: { projects: {} as Record<number, { number: number; url: string }> },
}));
vi.mock("@/rpc/connection.tsx", () => {
  const repository = { state: mocks.state, refresh: mocks.refresh };
  return { useConnected: () => ({ repository }) };
});
vi.mock("@/rpc/use-replicated-state.ts", () => ({ useReplicatedState: () => mocks.state }));

afterEach(() => {
  cleanup();
  mocks.refresh.mockClear();
  mocks.state.projects = {};
});

test("reads on opening and on busy to idle, not on every render", () => {
  const view = render(createElement(PullRequestLine, { workspaceId: 1, active: false }));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(view.container.textContent).toBe("");
  view.rerender(createElement(PullRequestLine, { workspaceId: 1, active: true }));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  view.rerender(createElement(PullRequestLine, { workspaceId: 1, active: false }));
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
  view.rerender(createElement(PullRequestLine, { workspaceId: 2, active: false }));
  expect(mocks.refresh).toHaveBeenCalledTimes(3);
});

test("renders only the current project's PR and hides it when removed", () => {
  mocks.state.projects[1] = { number: 33, url: "https://github.com/a/b/pull/33" };
  const view = render(createElement(PullRequestLine, { workspaceId: 1 }));
  expect(screen.getByRole("link").getAttribute("href")).toBe("https://github.com/a/b/pull/33");
  delete mocks.state.projects[1];
  view.rerender(createElement(PullRequestLine, { workspaceId: 1 }));
  expect(screen.queryByRole("link")).toBeNull();
});
