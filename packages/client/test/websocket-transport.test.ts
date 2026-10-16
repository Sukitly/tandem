import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createWebSocketTransportFactory } from "../src/websocket-transport.ts";

class Socket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "blob";
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
  });
  constructor() {
    super();
    Socket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
}
beforeEach(() => {
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(() => vi.unstubAllGlobals());

test("abort rejects a socket that never opens and ignores late events", async () => {
  const controller = new AbortController();
  const handlers = { onData: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
  const pending = createWebSocketTransportFactory("ws://localhost", { signal: controller.signal })(handlers);
  const socket = Socket.instances[0] as Socket;
  controller.abort();
  await expect(pending).rejects.toThrow("cancelled");
  expect(socket.close).toHaveBeenCalledOnce();
  socket.open();
  socket.dispatchEvent(new MessageEvent("message", { data: new ArrayBuffer(1) }));
  expect(handlers.onData).not.toHaveBeenCalled();
});

test("abort after open reports failure so a stalled protocol handshake can be cancelled", async () => {
  const controller = new AbortController();
  const handlers = { onData: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
  const pending = createWebSocketTransportFactory("ws://localhost", { signal: controller.signal })(handlers);
  const socket = Socket.instances[0] as Socket;
  socket.open();
  await pending;
  controller.abort();
  expect(handlers.onError).toHaveBeenCalledOnce();
  expect(socket.close).toHaveBeenCalledOnce();
});

test("closing removes cancellation listeners and prevents late data delivery", async () => {
  const controller = new AbortController();
  const handlers = { onData: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
  const pending = createWebSocketTransportFactory("ws://localhost", { signal: controller.signal })(handlers);
  const socket = Socket.instances[0] as Socket;
  socket.open();
  const transport = await pending;
  transport.close();
  controller.abort();
  socket.dispatchEvent(new MessageEvent("message", { data: new ArrayBuffer(1) }));
  expect(socket.close).toHaveBeenCalledOnce();
  expect(handlers.onData).not.toHaveBeenCalled();
  expect(handlers.onError).not.toHaveBeenCalled();
});
