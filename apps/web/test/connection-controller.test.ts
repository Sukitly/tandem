import { BootstrapError, type connect, type TandemConnection } from "@tandem/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ConnectionController } from "../src/rpc/connection-controller.ts";

type Connect = typeof connect;

function fakeConnection(deviceId = "device-1") {
  const closed = vi.fn(async () => {});
  const connection = {
    deviceId,
    // A bound service stands for itself, so a test can tell which one a name was given.
    services: { use: (service: { id: string }) => ({ bound: service.id }), observe: () => () => {} },
    status: { value: { status: "connected" }, subscribe: () => () => {} },
    terminal: vi.fn(),
    imageUrl: vi.fn((ref: unknown) => `/image/${JSON.stringify(ref)}`),
    close: closed,
  } as unknown as TandemConnection;
  return { connection, closed };
}

/** A `connect` the test settles by hand, attempt by attempt. */
function fakeConnect() {
  const attempts: {
    options: Parameters<Connect>[0];
    resolve(connection: TandemConnection): void;
    reject(error: unknown): void;
  }[] = [];
  const connectFn = vi.fn<Connect>(
    (options) =>
      new Promise<TandemConnection>((resolve, reject) => {
        attempts.push({ options, resolve, reject });
      }),
  );
  return { connectFn, attempts };
}

function setup(retryMs = 5_000) {
  const { connectFn, attempts } = fakeConnect();
  let wake = (): void => {};
  const stopWake = vi.fn();
  const controller = new ConnectionController({
    baseUrl: "http://tandem.test",
    retryMs,
    connect: connectFn,
    onWake: (listener) => {
      wake = listener;
      return stopWake;
    },
  });
  return { controller, connectFn, attempts, wake: () => wake(), stopWake };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("connecting", () => {
  test("is connecting until the first connection opens, and then holds the session the page reaches the server with", async () => {
    const { controller, attempts } = setup();
    expect(controller.getState()).toEqual({ kind: "connecting" });
    controller.start();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.options.baseUrl).toBe("http://tandem.test");

    const { connection } = fakeConnection("paired-browser");
    attempts[0]?.resolve(connection);
    await settle();
    const state = controller.getState();
    if (state.kind !== "connected") throw new Error(`expected connected, was ${state.kind}`);
    expect(state.session.deviceId).toBe("paired-browser");
    expect(state.session.connection).toBe(connection);
    // Each service is bound by the name components know it by.
    expect(state.session.models).toEqual({ bound: "tandem.models" });
    expect(state.session.workspaces).toEqual({ bound: "tandem.workspaces" });
    expect(state.session.publicAccess).toEqual({ bound: "tandem.public-access" });
    expect(state.session.open).toBeDefined();
    expect(state.session.openChanges).toBeDefined();
  });

  test("binds the services components use, and those opened one per conversation and per project", () => {
    const { controller, attempts } = setup();
    controller.start();
    const ids = (attempts[0]?.options.services ?? []).map((service) => service.id);
    for (const id of [
      "tandem.models",
      "tandem.devices",
      "tandem.workspaces",
      "tandem.conversations",
      "tandem.conversation",
      "tandem.changes",
      "tandem.projectChanges",
    ])
      expect(ids, id).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("notifies those who subscribed, until they stop", async () => {
    const { controller, attempts } = setup();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.start();
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    unsubscribe();
    attempts[0]?.resolve(fakeConnection().connection);
    await settle();
    expect(listener).not.toHaveBeenCalled();
    expect(controller.getState().kind).toBe("connected");
  });

  test("starting twice is one attempt", () => {
    const { controller, connectFn } = setup();
    controller.start();
    controller.start();
    expect(connectFn).toHaveBeenCalledOnce();
  });
});

describe("a connection that cannot be reached", () => {
  test("says why, and is tried again after the interval", async () => {
    const { controller, attempts } = setup(5_000);
    controller.start();
    attempts[0]?.reject(new Error("Connection refused"));
    await settle();
    const failed = controller.getState();
    expect(failed).toMatchObject({ kind: "failed", message: "Connection refused" });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toHaveLength(2);
    expect(controller.getState()).toEqual({ kind: "connecting" });

    attempts[1]?.resolve(fakeConnection().connection);
    await settle();
    expect(controller.getState().kind).toBe("connected");
  });

  test("is tried again at once when the person asks, and the interval's own attempt does not follow it", async () => {
    const { controller, attempts } = setup(5_000);
    controller.start();
    attempts[0]?.reject(new Error("Down"));
    await settle();
    const failed = controller.getState();
    if (failed.kind !== "failed") throw new Error("expected failed");
    failed.retry();
    expect(attempts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempts).toHaveLength(2);
  });

  test("is not tried again while an attempt is going", async () => {
    const { controller, attempts, wake } = setup();
    controller.start();
    wake();
    wake();
    expect(attempts).toHaveLength(1);
  });

  test("is tried again when the page returns to the foreground or the network returns", async () => {
    const { controller, attempts, wake } = setup(60_000);
    controller.start();
    attempts[0]?.reject(new Error("Offline"));
    await settle();
    wake();
    expect(attempts).toHaveLength(2);
  });

  test("a device that is not paired is not tried again", async () => {
    const { controller, attempts, wake } = setup(1_000);
    controller.start();
    attempts[0]?.reject(new BootstrapError(401));
    await settle();
    expect(controller.getState()).toEqual({ kind: "unauthorized" });
    wake();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toHaveLength(1);
  });

  test("a failure that is not an Error is shown as text", async () => {
    const { controller, attempts } = setup();
    controller.start();
    attempts[0]?.reject("plain");
    await settle();
    expect(controller.getState()).toMatchObject({ kind: "failed", message: "plain" });
  });
});

describe("a connection that is open", () => {
  test("is not opened again when the page wakes", async () => {
    const { controller, attempts, wake } = setup();
    controller.start();
    attempts[0]?.resolve(fakeConnection().connection);
    await settle();
    wake();
    expect(attempts).toHaveLength(1);
  });
});

describe("stopping", () => {
  test("closes the connection, stops listening for wakes, and goes back to connecting", async () => {
    const { controller, attempts, stopWake } = setup();
    controller.start();
    const { connection, closed } = fakeConnection();
    attempts[0]?.resolve(connection);
    await settle();
    controller.stop();
    expect(closed).toHaveBeenCalledOnce();
    expect(stopWake).toHaveBeenCalledOnce();
    expect(controller.getState()).toEqual({ kind: "connecting" });
    controller.stop();
    expect(closed).toHaveBeenCalledOnce();
  });

  test("cancels the attempt that is going, and closes a connection it opens too late", async () => {
    const { controller, attempts } = setup();
    controller.start();
    controller.stop();
    expect(attempts[0]?.options.signal?.aborted).toBe(true);
    const { connection, closed } = fakeConnection();
    attempts[0]?.resolve(connection);
    await settle();
    expect(closed).toHaveBeenCalledOnce();
    expect(controller.getState()).toEqual({ kind: "connecting" });
  });

  test("cancels the wait before the next attempt, and an attempt that fails too late is not shown", async () => {
    const { controller, attempts } = setup(1_000);
    controller.start();
    attempts[0]?.reject(new Error("Down"));
    await settle();
    controller.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempts).toHaveLength(1);

    controller.start();
    controller.stop();
    attempts[1]?.reject(new Error("Too late"));
    await settle();
    expect(controller.getState()).toEqual({ kind: "connecting" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempts).toHaveLength(2);
  });

  test("can be started again, as React replays an effect: only the second start is the connection", async () => {
    const { controller, attempts } = setup();
    controller.start();
    controller.stop();
    controller.start();
    expect(attempts).toHaveLength(2);

    const stale = fakeConnection("stale");
    const live = fakeConnection("live");
    attempts[0]?.resolve(stale.connection);
    attempts[1]?.resolve(live.connection);
    await settle();
    expect(stale.closed).toHaveBeenCalledOnce();
    expect(live.closed).not.toHaveBeenCalled();
    const state = controller.getState();
    if (state.kind !== "connected") throw new Error("expected connected");
    expect(state.session.deviceId).toBe("live");
  });
});
