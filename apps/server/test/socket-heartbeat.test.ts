import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WebSocket } from "ws";
import { startSocketHeartbeat } from "../src/socket-heartbeat.ts";

class Socket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  ping = vi.fn();
  terminate = vi.fn(() => {
    this.close();
  });
  close() {
    this.readyState = 3;
    this.emit("close");
  }
}
const sockets: Socket[] = [];
function open(interval = 30_000) {
  const socket = new Socket();
  sockets.push(socket);
  startSocketHeartbeat(socket as unknown as WebSocket, interval);
  return socket;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

test("sends pings and terminates a peer that misses the following deadline", () => {
  const socket = open();
  vi.advanceTimersByTime(30_000);
  expect(socket.ping).toHaveBeenCalledOnce();
  expect(socket.terminate).not.toHaveBeenCalled();
  vi.advanceTimersByTime(30_000);
  expect(socket.terminate).toHaveBeenCalledOnce();
  expect(socket.listenerCount("pong")).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("pong keeps the connection alive but ordinary messages do not replace pong", () => {
  const socket = open();
  vi.advanceTimersByTime(30_000);
  socket.emit("pong");
  vi.advanceTimersByTime(30_000);
  expect(socket.terminate).not.toHaveBeenCalled();
  socket.emit("message", Buffer.from("input"));
  vi.advanceTimersByTime(30_000);
  expect(socket.terminate).toHaveBeenCalledOnce();
});

test("close removes the timer and closing sockets are not pinged", () => {
  const socket = open();
  socket.readyState = 2;
  vi.advanceTimersByTime(30_000);
  expect(socket.ping).not.toHaveBeenCalled();
  socket.close();
  vi.advanceTimersByTime(60_000);
  expect(socket.terminate).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("zero disables the heartbeat", () => {
  open(0);
  expect(vi.getTimerCount()).toBe(0);
});
