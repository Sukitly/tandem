// @vitest-environment jsdom

import { createRemoteServiceBinding, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { BootstrapError, type ConnectionStatus, connect } from "@tandem/client";
import { PublicAccess } from "@tandem/contracts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { ConnectionProvider, useConnected } from "../src/rpc/connection.tsx";

vi.mock("@tandem/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tandem/client")>()),
  connect: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function ConnectedPage() {
  const { publicAccess, usage, repository } = useConnected();
  expect(publicAccess).toBeDefined();
  expect(usage).toBeDefined();
  expect(repository).toBeDefined();
  return createElement("div", null, "Connected");
}

test("registers every service used during page connection, including public access", async () => {
  const close = vi.fn();
  vi.mocked(connect).mockImplementation(async (options) => {
    // Use the real allowlist checks without opening a network connection.
    const services = createRemoteServiceBinding({
      services: options.services,
      bound: false,
      transport: { invoke: vi.fn(), subscribe: vi.fn() },
    });
    close.mockImplementation(() => services.dispose(BACKGROUND_CONTEXT));
    return {
      services,
      status: replicatedState<ConnectionStatus>({ status: "connected" }),
      terminal: vi.fn(),
      image: vi.fn(),
      imageUrl: vi.fn(),
      close,
    };
  });

  const page = render(
    createElement(ConnectionProvider, {
      fallback: (state) => createElement("div", null, state.kind),
      // biome-ignore lint/correctness/noChildrenProp: createElement requires the provider's mandatory children prop.
      children: createElement(ConnectedPage),
    }),
  );

  await screen.findByText("Connected");
  expect(vi.mocked(connect).mock.calls[0]?.[0].services).toContain(PublicAccess);
  page.unmount();
  expect(close).toHaveBeenCalledTimes(1);
});

test("retries connection after an initial failure when retry is called", async () => {
  let attempts = 0;
  const close = vi.fn();
  vi.mocked(connect).mockImplementation(async (options) => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("Network unreachable");
    }
    const services = createRemoteServiceBinding({
      services: options.services,
      bound: false,
      transport: { invoke: vi.fn(), subscribe: vi.fn() },
    });
    close.mockImplementation(() => services.dispose(BACKGROUND_CONTEXT));
    return {
      services,
      status: replicatedState<ConnectionStatus>({ status: "connected" }),
      terminal: vi.fn(),
      image: vi.fn(),
      imageUrl: vi.fn(),
      close,
    };
  });

  const page = render(
    createElement(ConnectionProvider, {
      fallback: (state) =>
        state.kind === "failed"
          ? createElement("button", { type: "button", onClick: state.retry }, `Retry: ${state.message}`)
          : createElement("div", null, state.kind),
      // biome-ignore lint/correctness/noChildrenProp: createElement requires the provider's mandatory children prop.
      children: createElement(ConnectedPage),
    }),
  );

  const retryButton = await screen.findByRole("button", { name: /Retry: Network unreachable/ });
  fireEvent.click(retryButton);

  await screen.findByText("Connected");
  expect(attempts).toBe(2);
  page.unmount();
});

function renderConnection() {
  return render(
    createElement(ConnectionProvider, {
      fallback: (state) => createElement("div", null, state.kind),
      // biome-ignore lint/correctness/noChildrenProp: createElement requires the provider's mandatory children prop.
      children: createElement("div", null, "Ready"),
    }),
  );
}

test.each(["online", "visibilitychange", "pageshow", "focus"])(
  "initial failure retries on %s without overlapping attempts",
  async (event) => {
    vi.useFakeTimers();
    vi.mocked(connect)
      .mockRejectedValueOnce(new Error("Offline"))
      .mockImplementation(() => new Promise(() => {}));
    const page = renderConnection();
    await act(async () => {});
    expect(screen.getByText("failed")).toBeDefined();
    act(() => {
      (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });
    expect(connect).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(connect).toHaveBeenCalledTimes(2);
    const signal = vi.mocked(connect).mock.calls[1]?.[0].signal;
    page.unmount();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  },
);

test("initial failure retries on the timer and unmount cancels future attempts", async () => {
  vi.useFakeTimers();
  vi.mocked(connect).mockRejectedValue(new Error("Offline"));
  const page = renderConnection();
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(connect).toHaveBeenCalledTimes(2);
  page.unmount();
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(connect).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

test("initial 401 never automatically retries", async () => {
  vi.useFakeTimers();
  vi.mocked(connect).mockRejectedValue(new BootstrapError(401));
  renderConnection();
  await act(async () => {});
  expect(screen.getByText("unauthorized")).toBeDefined();
  act(() => window.dispatchEvent(new Event("online")));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(connect).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
