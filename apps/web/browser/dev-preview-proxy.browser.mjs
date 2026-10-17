import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("the development preview proxy forwards HTTP paths and WebSocket upgrades", { timeout: 20000 }, async (t) => {
  const sockets = new Set();
  const backend = createHttpServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ path: request.url, cookie: request.headers.cookie }));
  });
  backend.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  backend.on("upgrade", (request, socket) => {
    assert.equal(request.url, "/preview/5173/hmr?channel=test");
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const text = Buffer.from("preview upgraded");
    socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => backend.close(resolve));
  });
  const vite = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    cacheDir: "node_modules/.vite-proxy-browser",
    server: {
      port: 0,
      strictPort: false,
      host: "127.0.0.1",
      proxy: { "/preview": { target: `http://127.0.0.1:${backend.address().port}` } },
    },
  });
  await vite.listen();
  t.after(() => vite.close());
  // ws comes from the real vite.config.ts, not the test override.
  assert.equal(vite.config.server.proxy["/preview"].ws, true);
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const response = await fetch(`${origin}/preview/5173/assets/app.js?version=2`, {
    headers: { cookie: "test-device=fixture" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    path: "/preview/5173/assets/app.js?version=2",
    cookie: "test-device=fixture",
  });
  const message = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`${origin.replace("http:", "ws:")}/preview/5173/hmr?channel=test`);
    socket.addEventListener("error", reject, { once: true });
    socket.addEventListener(
      "message",
      (event) => {
        resolve(event.data);
        socket.close();
      },
      { once: true },
    );
  });
  assert.equal(message, "preview upgraded");
});
