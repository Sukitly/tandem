import type { WebSocket } from "ws";

/** Native control frames keep idle mappings active and reclaim peers that stop answering. */
export function startSocketHeartbeat(socket: WebSocket, intervalMs = 30_000): void {
  if (intervalMs <= 0) return;
  let alive = true;
  const pong = (): void => {
    alive = true;
  };
  socket.on("pong", pong);
  const timer = setInterval(() => {
    if (socket.readyState !== socket.OPEN) return;
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, intervalMs);
  timer.unref();
  socket.once("close", () => {
    clearInterval(timer);
    socket.off("pong", pong);
  });
}
