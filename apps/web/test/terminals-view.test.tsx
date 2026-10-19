// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { TerminalsView } from "../src/terminals/terminals-view.tsx";

const mock = vi.hoisted(() => ({ create: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mock.error } }));
vi.mock("../src/terminals/terminal-view.tsx", () => ({ TerminalView: () => null }));
vi.mock("../src/app/workbench.tsx", () => ({ useWorkbench: () => ({ reportFailure: vi.fn() }) }));
vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({ terminals: { state: { terminals: [] }, create: mock.create } }),
}));
vi.mock("../src/rpc/use-replicated-state.ts", () => ({ useReplicatedState: (state: unknown) => state }));

afterEach(() => {
  cleanup();
  mock.create.mockReset();
  mock.error.mockReset();
});

test("opening a terminal is disabled while it opens, and a failure is reported and can be retried", async () => {
  let reject!: (error: Error) => void;
  mock.create
    .mockImplementationOnce(
      () =>
        new Promise<string>((_, failure) => {
          reject = failure;
        }),
    )
    .mockResolvedValue("t1");
  render(<TerminalsView workspaceId={7} active />);
  const button = screen.getByRole("button", { name: "New terminal" }) as HTMLButtonElement;
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mock.create).toHaveBeenCalledOnce();
  expect(mock.create).toHaveBeenCalledWith({ workspaceId: 7 }, expect.anything());
  await waitFor(() => expect(button.disabled).toBe(true));

  await act(async () => reject(new Error("No shell available")));
  expect(mock.error).toHaveBeenCalledWith("Could not open a terminal", { description: "No shell available" });
  expect(button.disabled).toBe(false);

  fireEvent.click(button);
  await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(2));
});
