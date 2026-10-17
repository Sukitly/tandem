import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BootstrapError, connect, type TandemConnection } from "../src/connect.ts";

class FakeClient {
  connected = false;
  serverId = "server";
  listener: (change: { state: string; error?: Error }) => void = () => {};
  connect = vi.fn(async () => {
    this.change("connected");
  });
  serviceCatalogue = vi.fn((_target: unknown, _signal?: AbortSignal): Promise<unknown[]> => Promise.resolve([]));
  disconnect = vi.fn(() => {
    if (this.connected) this.change("disconnected");
  });
  dispose = vi.fn(async () => {});
  onConnectionStateChange(listener: FakeClient["listener"]) {
    this.listener = listener;
    return () => {
      this.listener = () => {};
    };
  }
  change(state: string) {
    this.connected = state === "connected";
    this.listener({ state });
  }
}
let fake: FakeClient;
vi.mock("@earendil-works/pi-client", () => ({
  Client: vi.fn(function Client() {
    return fake;
  }),
  createClientServiceTransport: () => ({ invoke: vi.fn(), subscribe: vi.fn() }),
}));

const connections: TandemConnection[] = [];
let page: EventTarget & { visibilityState: string };
let browser: EventTarget;
const fetchMock = vi.fn<typeof fetch>();
const response = () => Response.json({ serverId: "server" });
const options = { baseUrl: "http://localhost", services: [], reconnect: { initialDelayMs: 60_000 } };
async function open(overrides = {}) {
  const connection = await connect({ ...options, ...overrides });
  connections.push(connection);
  return connection;
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  fake = new FakeClient();
  page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  browser = new EventTarget();
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", browser);
  vi.stubGlobal("navigator", { onLine: true });
  fetchMock.mockReset().mockImplementation(async () => response());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.close();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test.each(["visibilitychange", "online", "pageshow", "focus"])(
  "%s bypasses backoff and coalesces wake events",
  async (event) => {
    const connection = await open();
    fake.change("disconnected");
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const target = event === "visibilitychange" ? page : browser;
    target.dispatchEvent(new Event(event));
    browser.dispatchEvent(new Event("focus"));
    page.dispatchEvent(new Event("visibilitychange"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending.resolve(response());
    await flush();
    expect(fake.connect).toHaveBeenCalledTimes(2);
    expect(connection.status.value?.status).toBe("connected");
  },
);

test("probes the existing RPC connection and replaces a half-open socket after the deadline", async () => {
  const connection = await open();
  fake.serviceCatalogue.mockImplementationOnce(() => new Promise(() => {}));
  browser.dispatchEvent(new Event("online"));
  page.dispatchEvent(new Event("visibilitychange"));
  expect(fake.serviceCatalogue).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(fake.disconnect).toHaveBeenCalledTimes(1);
  expect(fake.connect).toHaveBeenCalledTimes(2);
  expect(connection.status.value?.status).toBe("connected");
});

test("a healthy probe does not reconnect, and periodic probes detect silent failures", async () => {
  await open();
  browser.dispatchEvent(new Event("focus"));
  await flush();
  expect(fake.connect).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fake.serviceCatalogue).toHaveBeenCalledTimes(2);
});

test("a stale probe failure cannot disconnect a replacement connection", async () => {
  const connection = await open();
  const pending = deferred<unknown[]>();
  fake.serviceCatalogue.mockReturnValueOnce(pending.promise);
  browser.dispatchEvent(new Event("focus"));
  fake.change("disconnected");
  browser.dispatchEvent(new Event("online"));
  await flush();
  pending.reject(new Error("Old socket failed"));
  await flush();
  expect(connection.status.value?.status).toBe("connected");
  expect(fake.disconnect).not.toHaveBeenCalled();
});

test("401 stops retries and remains unauthorized after disconnect and wake events", async () => {
  const connection = await open();
  fake.serviceCatalogue.mockRejectedValueOnce(new Error("Revoked"));
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
  browser.dispatchEvent(new Event("focus"));
  await flush();
  expect(connection.status.value?.status).toBe("unauthorized");
  fake.change("disconnected");
  browser.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(connection.status.value?.status).toBe("unauthorized");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("close cancels a pending bootstrap and ignores its late response", async () => {
  const connection = await open();
  fake.change("disconnected");
  const pending = deferred<Response>();
  fetchMock.mockReturnValueOnce(pending.promise);
  browser.dispatchEvent(new Event("online"));
  const signal = fetchMock.mock.calls.at(-1)?.[1]?.signal;
  await connection.close();
  expect(signal?.aborted).toBe(true);
  pending.resolve(response());
  await flush();
  browser.dispatchEvent(new Event("online"));
  expect(fake.connect).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("initial bootstrap times out even if fetch does not settle on abort", async () => {
  fetchMock.mockImplementationOnce(() => new Promise(() => {}));
  const result = expect(connect(options)).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(10_000);
  await result;
  expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

test("initial handshake times out and disposes resources", async () => {
  fake.connect.mockImplementationOnce(() => new Promise(() => {}));
  const result = expect(connect(options)).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(10_000);
  await result;
  expect(fake.dispose).toHaveBeenCalledOnce();
});

test("failed initial bootstrap rejects 401 without retries", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
  await expect(connect(options)).rejects.toBeInstanceOf(BootstrapError);
});

test("external abort cancels initial bootstrap", async () => {
  const controller = new AbortController();
  fetchMock.mockImplementationOnce(() => new Promise(() => {}));
  const pending = connect({ ...options, signal: controller.signal });
  controller.abort(new Error("Unmounted"));
  await expect(pending).rejects.toThrow("Unmounted");
});

test("hidden, offline, disabled and closed connections do not wake", async () => {
  const connection = await open({ reconnect: false });
  fake.change("disconnected");
  browser.dispatchEvent(new Event("online"));
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(connection.status.value).toMatchObject({ status: "disconnected", retryInMs: null });
  await connection.close();
  await open();
  fake.change("disconnected");
  page.visibilityState = "hidden";
  browser.dispatchEvent(new Event("online"));
  page.visibilityState = "visible";
  vi.stubGlobal("navigator", { onLine: false });
  browser.dispatchEvent(new Event("focus"));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("a timed-out retry can recover and its late bootstrap cannot reopen the connection", async () => {
  const connection = await open();
  fake.change("disconnected");
  const pending = deferred<Response>();
  fetchMock.mockReturnValueOnce(pending.promise);
  browser.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(connection.status.value?.status).toBe("disconnected");
  browser.dispatchEvent(new Event("online"));
  await flush();
  expect(connection.status.value?.status).toBe("connected");
  pending.resolve(response());
  await flush();
  expect(fake.connect).toHaveBeenCalledTimes(2);
  expect(connection.status.value?.status).toBe("connected");
});

test("close cancels a probe, ignores its late rejection, and shares disposal work", async () => {
  const connection = await open();
  const pending = deferred<unknown[]>();
  fake.serviceCatalogue.mockReturnValueOnce(pending.promise);
  browser.dispatchEvent(new Event("focus"));
  const signal = fake.serviceCatalogue.mock.calls[0]?.[1];
  const closing = connection.close();
  expect(connection.close()).toBe(closing);
  await closing;
  expect(signal?.aborted).toBe(true);
  pending.reject(new Error("Stale probe"));
  await flush();
  expect(fake.connect).toHaveBeenCalledTimes(1);
  expect(fake.dispose).toHaveBeenCalledOnce();
});
