// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { StatusBar } from "../src/chat/status-bar.tsx";

interface Model {
  provider: string;
  modelId: string;
  name: string;
  contextWindow: number;
  thinkingLevels: string[];
}
const model = (provider: string, modelId: string, thinkingLevels = ["off", "high"]): Model => ({
  provider,
  modelId,
  name: `${modelId} model`,
  contextWindow: 0,
  thinkingLevels,
});

const mock = vi.hoisted(() => ({
  configure: vi.fn(),
  setDefaultModel: vi.fn(),
  setDefaultThinkingLevel: vi.fn(),
  openProviders: vi.fn(),
  error: vi.fn(),
  state: { models: [] as unknown[], providers: [] as unknown[] },
}));
vi.mock("sonner", () => ({ toast: { error: mock.error } }));
vi.mock("../src/models/providers-dialog.tsx", () => ({ useProvidersDialog: () => ({ open: mock.openProviders }) }));
vi.mock("../src/rpc/use-replicated-state.ts", () => ({ useReplicatedState: (state: unknown) => state }));
vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({
    models: {
      state: mock.state,
      setDefaultModel: mock.setDefaultModel,
      setDefaultThinkingLevel: mock.setDefaultThinkingLevel,
    },
  }),
}));

beforeEach(() => {
  mock.state = {
    models: [model("example", "Old"), model("example", "New")],
    providers: [{ id: "example", name: "Example" }],
  };
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

function setup(agent: { model?: { provider: string; modelId: string }; thinkingLevel?: string } | undefined) {
  render(<StatusBar agent={agent} usage={{ tokens: 0, cost: 0 }} onConfigure={mock.configure} />);
  return { trigger: () => screen.getByRole("button", { name: /model|Choose|unavailable/ }) as HTMLButtonElement };
}
const old = { model: { provider: "example", modelId: "Old" }, thinkingLevel: "off" };

test("the model and its thinking level are one button, and the menu lists the models under their providers", async () => {
  mock.state = {
    models: [model("example", "Old"), model("example", "New"), model("other", "Plain", ["off"])],
    providers: [
      { id: "example", name: "Example" },
      { id: "other", name: "Other Provider" },
    ],
  };
  const { trigger } = setup(old);
  expect(trigger().textContent).toContain("Old model");
  expect(trigger().textContent).toContain("Off");
  fireEvent.click(trigger());
  const menu = await screen.findByRole("menu");
  expect(within(menu).getByText("Example")).toBeDefined();
  expect(within(menu).getByText("Other Provider")).toBeDefined();
  const rows = within(menu).getAllByRole("menuitemradio");
  expect(rows.map((row) => row.textContent)).toEqual(["Old model", "New model", "Plain model"]);
  expect(rows[0]?.getAttribute("aria-checked")).toBe("true");
  // Few enough to be seen at once, so there is nothing to search.
  expect(screen.queryByLabelText("Search models")).toBeNull();
});

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
  const { trigger } = setup(old);
  fireEvent.click(trigger());
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "New model" }));
  await waitFor(() => expect(mock.configure).toHaveBeenCalledOnce());
  // The level that goes with the model is not passed on: the server lowers one that the model has not got.
  expect(mock.configure).toHaveBeenCalledWith({ model: { provider: "example", modelId: "New" } });
  expect(trigger().disabled).toBe(true);
  expect(mock.setDefaultModel).not.toHaveBeenCalled();
  await act(async () => reject(new Error("Configuration denied")));
  expect(mock.error).toHaveBeenCalledWith("Could not save model selection", { description: "Configuration denied" });
  expect(trigger().disabled).toBe(false);
  fireEvent.click(trigger());
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "New model" }));
  await waitFor(() => expect(mock.setDefaultModel).toHaveBeenCalledOnce());
});

test("thinking changes also report failures instead of changing defaults independently", async () => {
  mock.configure.mockRejectedValue(new Error("Thinking unavailable"));
  const { trigger } = setup(old);
  fireEvent.click(trigger());
  fireEvent.click(await screen.findByRole("menuitem", { name: /Thinking/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "High" }));
  await waitFor(() =>
    expect(mock.error).toHaveBeenCalledWith("Could not save thinking level", { description: "Thinking unavailable" }),
  );
  expect(mock.setDefaultThinkingLevel).not.toHaveBeenCalled();
});

test("a thinking level that is saved becomes the default for new conversations", async () => {
  mock.configure.mockResolvedValue(undefined);
  mock.setDefaultThinkingLevel.mockResolvedValue(undefined);
  const { trigger } = setup(old);
  fireEvent.click(trigger());
  fireEvent.click(await screen.findByRole("menuitem", { name: /Thinking/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "High" }));
  await waitFor(() => expect(mock.setDefaultThinkingLevel).toHaveBeenCalledWith("high", expect.anything()));
  expect(mock.configure).toHaveBeenCalledWith({ thinkingLevel: "high" });
});

test("the levels are those of the chosen model, and a model with one has nothing to choose", async () => {
  mock.state = {
    models: [model("example", "Deep", ["off", "low", "medium", "high"]), model("example", "Plain", ["off"])],
    providers: [{ id: "example", name: "Example" }],
  };
  const { trigger } = setup({ model: { provider: "example", modelId: "Deep" }, thinkingLevel: "medium" });
  expect(trigger().textContent).toContain("Medium");
  fireEvent.click(trigger());
  fireEvent.click(await screen.findByRole("menuitem", { name: /Thinking/ }));
  const levels = await screen.findAllByRole("menuitemradio", { name: /^(Off|Low|Medium|High)$/ });
  expect(levels.map((level) => level.textContent)).toEqual(["Off", "Low", "Medium", "High"]);
  cleanup();

  const plain = setup({ model: { provider: "example", modelId: "Plain" }, thinkingLevel: "off" });
  expect(plain.trigger().textContent).not.toContain("Off");
  fireEvent.click(plain.trigger());
  await screen.findByRole("menu");
  expect(screen.queryByRole("menuitem", { name: /Thinking/ })).toBeNull();
});

test("models of one id from two providers are told apart", async () => {
  mock.state = {
    models: [model("a", "same"), model("b", "same")],
    providers: [
      { id: "a", name: "Provider A" },
      { id: "b", name: "Provider B" },
    ],
  };
  mock.configure.mockResolvedValue(undefined);
  mock.setDefaultModel.mockResolvedValue(undefined);
  const { trigger } = setup({ model: { provider: "b", modelId: "same" }, thinkingLevel: "off" });
  fireEvent.click(trigger());
  const rows = await screen.findAllByRole("menuitemradio", { name: "same model" });
  expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  fireEvent.click(rows[0] as HTMLElement);
  await waitFor(() => expect(mock.configure).toHaveBeenCalledWith({ model: { provider: "a", modelId: "same" } }));
});

test("a model that is not available is said to be, and none chosen says so", () => {
  const gone = setup({ model: { provider: "example", modelId: "Gone" }, thinkingLevel: "off" });
  expect(gone.trigger().textContent).toContain("Gone (unavailable)");
  cleanup();
  const none = setup(undefined);
  expect(none.trigger().textContent).toContain("Choose a model");
});

test("with no model to choose the box offers to sign in to a provider", () => {
  mock.state = { models: [], providers: [] };
  setup(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Sign in to a model provider" }));
  expect(mock.openProviders).toHaveBeenCalledOnce();
});

test("the menu leads to the providers, and closes as it does", async () => {
  const { trigger } = setup(old);
  fireEvent.click(trigger());
  fireEvent.click(await screen.findByRole("menuitem", { name: "Model providers…" }));
  expect(mock.openProviders).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
});

test("more than six models have a search, which finds a model by its provider", async () => {
  mock.state = {
    models: [...[0, 1, 2, 3].map((n) => model("big", `Big${n}`)), ...[0, 1, 2].map((n) => model("small", `Small${n}`))],
    providers: [
      { id: "big", name: "Large Lab" },
      { id: "small", name: "Little Lab" },
    ],
  };
  const { trigger } = setup({ model: { provider: "big", modelId: "Big0" }, thinkingLevel: "off" });
  fireEvent.click(trigger());
  const search = await screen.findByLabelText("Search models");
  expect(screen.getAllByRole("menuitemradio")).toHaveLength(7);
  fireEvent.change(search, { target: { value: "little" } });
  await waitFor(() => expect(screen.getAllByRole("menuitemradio")).toHaveLength(3));
  expect(screen.getAllByRole("menuitemradio").map((row) => row.textContent)).toEqual([
    "Small0 model",
    "Small1 model",
    "Small2 model",
  ]);
  fireEvent.change(search, { target: { value: "nothing like it" } });
  await waitFor(() => expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0));
  expect(await screen.findByText("No models found")).toBeDefined();
  // A row that does not match is put away, and so is the way to the providers, as it was with the old list.
  expect(screen.queryByRole("menuitem", { name: "Model providers…" })).toBeNull();
  fireEvent.change(search, { target: { value: "" } });
  await waitFor(() => expect(screen.getAllByRole("menuitemradio")).toHaveLength(7));
  expect(screen.getByRole("menuitem", { name: "Model providers…" })).toBeDefined();
});
