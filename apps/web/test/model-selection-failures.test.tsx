// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { StatusBar } from "../src/chat/status-bar.tsx";

const mock = vi.hoisted(() => ({
  configure: vi.fn(),
  setDefaultModel: vi.fn(),
  setDefaultThinkingLevel: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: mock.error } }));
vi.mock("../src/models/providers-dialog.tsx", () => ({ useProvidersDialog: () => ({ open: vi.fn() }) }));
vi.mock("../src/rpc/use-replicated-state.ts", () => ({ useReplicatedState: (state: unknown) => state }));
vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({
    models: {
      state: {
        models: ["Old", "New"].map((name) => ({
          provider: "example",
          modelId: name,
          name: `${name} model`,
          contextWindow: 0,
          thinkingLevels: ["off", "high"],
        })),
        providers: [{ id: "example", name: "Example" }],
      },
      setDefaultModel: mock.setDefaultModel,
      setDefaultThinkingLevel: mock.setDefaultThinkingLevel,
    },
  }),
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});
function setup() {
  render(
    <StatusBar
      agent={{ model: { provider: "example", modelId: "Old" }, thinkingLevel: "off" }}
      usage={{ tokens: 0, cost: 0 }}
      onConfigure={mock.configure}
    />,
  );
}

test("failed model changes leave defaults alone, show an error, and permit retry", async () => {
  let reject!: (error: Error) => void;
  mock.configure
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, failure) => {
          reject = failure;
        }),
    )
    .mockResolvedValue(undefined);
  mock.setDefaultModel.mockResolvedValue(undefined);
  setup();
  const trigger = screen.getByRole("button", { name: "Old model" });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: "New model" }));
  await waitFor(() => expect(mock.configure).toHaveBeenCalledOnce());
  expect((trigger as HTMLButtonElement).disabled).toBe(true);
  expect(mock.setDefaultModel).not.toHaveBeenCalled();
  await act(async () => reject(new Error("Configuration denied")));
  expect(mock.error).toHaveBeenCalledWith("Could not save model selection", { description: "Configuration denied" });
  expect((trigger as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: "New model" }));
  await waitFor(() => expect(mock.setDefaultModel).toHaveBeenCalledOnce());
});

test("thinking changes also report failures instead of changing defaults independently", async () => {
  mock.configure.mockRejectedValue(new Error("Thinking unavailable"));
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Off/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "High" }));
  await waitFor(() =>
    expect(mock.error).toHaveBeenCalledWith("Could not save thinking level", { description: "Thinking unavailable" }),
  );
  expect(mock.setDefaultThinkingLevel).not.toHaveBeenCalled();
});
