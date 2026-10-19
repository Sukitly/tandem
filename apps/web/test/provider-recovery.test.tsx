// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ProvidersDialogProvider, useProvidersDialog } from "../src/models/providers-dialog.tsx";

const mock = vi.hoisted(() => ({
  login: vi.fn(),
  state: {
    providers: [
      {
        id: "example",
        name: "Example",
        configured: { type: "oauth" },
        stored: true,
        login: [{ type: "oauth", label: "Account" }],
      },
    ],
    login: {
      providerId: "example",
      providerName: "Example",
      status: "failed",
      events: [],
      error: "Denied",
      prompt: { id: "stale", type: "text", message: "Old challenge" },
    },
  },
}));
vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({ models: { state: mock.state, login: mock.login } }),
}));
vi.mock("../src/rpc/use-replicated-state.ts", () => ({ useReplicatedState: (state: unknown) => state }));
afterEach(() => {
  cleanup();
  mock.login.mockReset();
  mock.state.login.status = "failed";
});
function Launcher() {
  const dialog = useProvidersDialog();
  return (
    <button type="button" onClick={() => dialog.open("example")}>
      Configure provider
    </button>
  );
}
function setup() {
  render(
    <ProvidersDialogProvider>
      <Launcher />
    </ProvidersDialogProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Configure provider" }));
}

test("failed login offers retry, hides stale prompts, and reports a failed retry", async () => {
  let reject!: (error: Error) => void;
  mock.login.mockImplementation(
    () =>
      new Promise<void>((_, failure) => {
        reject = failure;
      }),
  );
  setup();
  expect(screen.queryByText("Old challenge")).toBeNull();
  const retry = screen.getByRole("button", { name: "Retry sign-in" });
  fireEvent.click(retry);
  await waitFor(() => expect(mock.login).toHaveBeenCalledOnce());
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  await act(async () => reject(new Error("Server unavailable")));
  expect(screen.getByText("Server unavailable")).toBeTruthy();
  expect((retry as HTMLButtonElement).disabled).toBe(false);
});

test("completed login keeps reauthentication and sign-out available", () => {
  mock.state.login.status = "succeeded";
  setup();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
});
