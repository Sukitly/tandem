// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useWorkbench, WorkbenchProvider } from "../src/app/workbench.tsx";
import { useProjectChanges } from "../src/rpc/use-project-changes.ts";

const mock = vi.hoisted(() => ({
  listed: { workspaces: [{ id: 1 }] },
  release: vi.fn(),
  hold: vi.fn(),
  files: { read: vi.fn(async () => ({ kind: "text", text: "contents", size: 8 })), list: vi.fn(async () => []) },
}));
vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({
    workspaces: { state: mock.listed },
    conversations: { state: { conversations: [] } },
    files: mock.files,
    comments: {},
    openChanges: openChanges,
  }),
}));
const openChanges = {
  hold: (id: number) => {
    mock.hold(id);
    return mock.release;
  },
  get: () => undefined,
  subscribe: () => () => {},
};
vi.mock("../src/rpc/use-replicated-state.ts", () => ({ useReplicatedState: (state: unknown) => state }));
vi.mock("../src/hooks/use-mobile.ts", () => ({ useIsMobile: () => false }));
vi.mock("../src/app/add-project-dialog.tsx", () => ({ AddProjectDialog: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mock.listed = { workspaces: [{ id: 1 }] };
});

test("removed projects release file snapshots and cached comment wrappers", async () => {
  const hook = renderHook(useWorkbench, { wrapper: WorkbenchProvider });
  const file = hook.result.current.projectFiles(1);
  const comments = hook.result.current.comments(1);
  const close = vi.spyOn(file, "close");
  act(() => file.open("file.txt"));
  await waitFor(() => expect(file.content?.status).toBe("ready"));
  mock.listed = { workspaces: [] };
  hook.rerender();
  expect(close).toHaveBeenCalledOnce();
  expect(file.opened).toBeNull();
  expect(hook.result.current.projectFiles(1)).not.toBe(file);
  expect(hook.result.current.comments(1)).not.toBe(comments);
});

test("changes are not opened before first use and the hold is released on unmount", () => {
  const hook = renderHook(({ enabled }) => useProjectChanges(1, enabled), { initialProps: { enabled: false } });
  expect(mock.hold).not.toHaveBeenCalled();
  hook.rerender({ enabled: true });
  expect(mock.hold).toHaveBeenCalledWith(1);
  hook.rerender({ enabled: true });
  expect(mock.hold).toHaveBeenCalledOnce();
  hook.rerender({ enabled: false });
  expect(mock.release).toHaveBeenCalledOnce();
  hook.rerender({ enabled: false });
  expect(mock.release).toHaveBeenCalledOnce();
  hook.rerender({ enabled: true });
  expect(mock.hold).toHaveBeenCalledTimes(2);
  hook.unmount();
  expect(mock.release).toHaveBeenCalledTimes(2);
});
