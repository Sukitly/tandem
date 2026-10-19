import { defineService } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { describe, expect, it, vi } from "vitest";
import type { TandemConnection } from "../src/connect.ts";
import { OpenInstances } from "../src/open-instances.ts";

function setup() {
  const statusListeners = new Set<(status: { status: string }) => void>();
  const attempts: Array<{ reject(error: Error): void; resolve(): void }> = [];
  let track: (instance: object, context: typeof BACKGROUND_CONTEXT) => Promise<void> = async () => {};
  const connection = {
    status: {
      value: { status: "connected" },
      subscribe: (listener: (status: { status: string }) => void) => {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
    },
    services: {
      observe: (_service: unknown, callback: typeof track) => {
        track = callback;
        return () => {};
      },
    },
  };
  const open = vi.fn(() => new Promise<void>((resolve, reject) => attempts.push({ resolve, reject })));
  const onError = vi.fn();
  const instances = new OpenInstances<number, object>(
    connection as unknown as TandemConnection,
    {
      service: defineService<object>("test.instance"),
      open,
      close: async () => {},
      keyOf: async () => 7,
    },
    onError,
  );
  return {
    instances,
    open,
    onError,
    attempts,
    track: (instance: object) => track(instance, BACKGROUND_CONTEXT),
    reconnect: () => {
      for (const status of ["disconnected", "connected"]) {
        connection.status.value = { status };
        for (const listener of statusListeners) listener(connection.status.value);
      }
    },
  };
}

describe("opening instance failures", () => {
  it("exposes failures, clears them on retry, and deduplicates concurrent retries", async () => {
    const f = setup();
    const notify = vi.fn();
    f.instances.subscribe(notify);
    f.instances.hold(7);
    f.attempts[0]?.reject(new Error("No access"));
    await Promise.resolve();
    expect(f.instances.failure(7)?.message).toBe("No access");
    expect(notify).toHaveBeenCalled();
    f.instances.retry(7);
    f.instances.retry(7);
    expect(f.instances.failure(7)).toBeUndefined();
    expect(f.open).toHaveBeenCalledTimes(2);
    const instance = {};
    await f.track(instance);
    f.attempts[1]?.resolve();
    expect(f.instances.get(7)).toBe(instance);
    f.instances.dispose();
  });

  it("ignores stale failures after reconnection and after the last holder leaves", async () => {
    const f = setup();
    const release = f.instances.hold(7);
    f.reconnect();
    f.attempts[0]?.reject(new Error("Old connection"));
    await Promise.resolve();
    expect(f.instances.failure(7)).toBeUndefined();
    release();
    f.attempts[1]?.reject(new Error("Already left"));
    await Promise.resolve();
    expect(f.instances.failure(7)).toBeUndefined();
    expect(f.onError).not.toHaveBeenCalled();
    f.instances.dispose();
  });

  it("notifies when the last release clears a failure, but not on duplicate release", async () => {
    const f = setup();
    const release = f.instances.hold(7);
    const other = f.instances.hold(7);
    const seen: (string | undefined)[] = [];
    f.instances.subscribe(() => seen.push(f.instances.failure(7)?.message));
    f.attempts[0]?.reject(new Error("No access"));
    await Promise.resolve();
    release();
    expect(seen).toEqual(["No access"]);
    other();
    other();
    expect(seen).toEqual(["No access", undefined]);
    f.instances.dispose();
  });

  it("does not publish a late failure after disposal", async () => {
    const f = setup();
    f.instances.hold(7);
    f.instances.dispose();
    f.attempts[0]?.reject(new Error("Disposed"));
    await Promise.resolve();
    expect(f.onError).not.toHaveBeenCalled();
    expect(f.instances.failure(7)).toBeUndefined();
  });
});
