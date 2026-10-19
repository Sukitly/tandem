// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { ConnectionProvider, useConnected } from "../src/rpc/connection.tsx";

const client = vi.hoisted(() => {
  class BootstrapError extends Error {
    readonly status: number;
    constructor(status: number) {
      super(`status ${status}`);
      this.status = status;
    }
  }
  return {
    BootstrapError,
    attempts: [] as { resolve(connection: unknown): void; reject(error: unknown): void }[],
    closed: vi.fn(),
    status: { value: { status: "connected" } as { status: string } | undefined, listeners: new Set<() => void>() },
  };
});
vi.mock("@tandem/client", () => ({
  BootstrapError: client.BootstrapError,
  onConnectionWake: () => () => {},
  OpenConversations: class {
    dispose() {}
  },
  OpenChanges: class {
    dispose() {}
  },
  connect: () =>
    new Promise((resolve, reject) => {
      client.attempts.push({ resolve, reject });
    }),
}));
vi.mock("../src/auth/pair-screen.tsx", () => ({ PairScreen: () => <p>Pair this device</p> }));
vi.mock("../src/rpc/use-replicated-state.ts", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useReplicatedState: () =>
      useSyncExternalStore(
        (listener) => {
          client.status.listeners.add(listener);
          return () => client.status.listeners.delete(listener);
        },
        () => client.status.value,
      ),
  };
});

function connection(deviceId: string) {
  return {
    deviceId,
    services: { use: (service: { id: string }) => ({ bound: service.id }), observe: () => () => {} },
    status: { value: { status: "connected" }, subscribe: () => () => {} },
    terminal: vi.fn(),
    imageUrl: vi.fn(),
    close: client.closed,
  };
}

function Page() {
  const { deviceId, models } = useConnected();
  return (
    <p>
      {deviceId} {JSON.stringify(models)}
    </p>
  );
}
const fallback = (state: { kind: string }) => <p>Fallback {state.kind}</p>;

afterEach(() => {
  cleanup();
  client.attempts.length = 0;
  client.closed.mockClear();
  client.status.value = { status: "connected" };
});

test("shows the fallback until the connection opens, then the page, which reaches the server through it", async () => {
  render(
    <ConnectionProvider fallback={fallback}>
      <Page />
    </ConnectionProvider>,
  );
  expect(screen.getByText("Fallback connecting")).toBeTruthy();
  await act(async () => client.attempts[0]?.resolve(connection("browser-1")));
  expect(screen.getByText(/browser-1/).textContent).toContain('{"bound":"tandem.models"}');
});

test("a device that is not paired is given to the fallback to pair", async () => {
  render(
    <ConnectionProvider fallback={fallback}>
      <Page />
    </ConnectionProvider>,
  );
  await act(async () => client.attempts[0]?.reject(new client.BootstrapError(401)));
  expect(screen.getByText("Fallback unauthorized")).toBeTruthy();
});

test("a connection that loses its authorization offers pairing in place of the page", async () => {
  render(
    <ConnectionProvider fallback={fallback}>
      <Page />
    </ConnectionProvider>,
  );
  await act(async () => client.attempts[0]?.resolve(connection("browser-1")));
  act(() => {
    client.status.value = { status: "unauthorized" };
    for (const listener of client.status.listeners) listener();
  });
  expect(screen.getByText("Pair this device")).toBeTruthy();
  expect(screen.queryByText(/browser-1/)).toBeNull();
});

test("leaves one connection of the two attempts React's replay of the effect makes, and closes it on unmount", async () => {
  const view = render(
    <StrictMode>
      <ConnectionProvider fallback={fallback}>
        <Page />
      </ConnectionProvider>
    </StrictMode>,
  );
  await waitFor(() => expect(client.attempts.length).toBeGreaterThanOrEqual(2));
  await act(async () => {
    for (const [index, attempt] of client.attempts.entries()) attempt.resolve(connection(`browser-${index}`));
  });
  const live = client.attempts.length - 1;
  expect(screen.getByText(new RegExp(`browser-${live}`))).toBeTruthy();
  // Every connection but the live one was closed as it arrived.
  expect(client.closed).toHaveBeenCalledTimes(client.attempts.length - 1);
  view.unmount();
  expect(client.closed).toHaveBeenCalledTimes(client.attempts.length);
});
