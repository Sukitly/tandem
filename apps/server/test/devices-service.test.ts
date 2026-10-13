import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { connect, type TandemConnection } from "@tandem/client";
import { Devices, PAIR_PATH, Terminals, terminalPath, Workspaces } from "@tandem/contracts";
import { afterEach, expect, test, vi } from "vitest";
import { WebSocket as RawSocket } from "ws";
import { startApp } from "../src/app.ts";
import { createFauxProvider } from "../src/models.ts";
import type { TandemServer } from "../src/server.ts";

const context = BACKGROUND_CONTEXT;
const servers: TandemServer[] = [];
const connections: TandemConnection[] = [];
const sockets: RawSocket[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const connection of connections.splice(0)) await connection.close();
  for (const server of servers.splice(0)) await server.stop();
});
async function start() {
  const stateDir = await mkdtemp(join(tmpdir(), "tandem-device-app-"));
  const server = await startApp({ port: 0, stateDir, providers: [createFauxProvider()], terminalCommand: ["/bin/sh"] });
  servers.push(server);
  return server;
}
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for device state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("Devices publishes mutations and rejects invalid RPC input", async () => {
  const server = await start();
  const connection = await connect({ baseUrl: server.url, token: server.token, services: [Devices] });
  connections.push(connection);
  await connection.services.ready(context);
  const devices = connection.services.use(Devices);
  await waitFor(() => devices.state.value?.recoveryCodesRemaining === 0);
  const pair = await devices.addDevice(context);
  const response = await fetch(new URL(PAIR_PATH, server.url), {
    method: "POST",
    headers: { origin: server.url.origin, "content-type": "application/json" },
    body: JSON.stringify({ code: pair.code }),
  });
  expect(response.status).toBe(200);
  await waitFor(() => devices.state.value?.devices.length === 1);
  const id = devices.state.value?.devices[0]?.id as string;
  await devices.rename(id, "Phone", context);
  await waitFor(() => devices.state.value?.devices[0]?.name === "Phone");
  await expect(devices.rename(id, "", context)).rejects.toThrow(/1 to 80/);
  await expect(devices.revoke("missing", context)).rejects.toThrow(/does not exist/);
  await devices.regenerateRecoveryCodes(context);
  await waitFor(() => devices.state.value?.recoveryCodesRemaining === 10);
  await devices.revoke(id, context);
  await waitFor(() => devices.state.value?.devices.length === 0);
});

test("a revoked browser returns to unauthorized rather than retrying forever, and its terminal socket closes", async () => {
  const server = await start();
  const response = await fetch(new URL(PAIR_PATH, server.url), {
    method: "POST",
    headers: { origin: server.url.origin, "content-type": "application/json" },
    body: JSON.stringify({ code: server.pair().code }),
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0] as string;
  // Node has no cookie jar. Emulate browser transport credentials, not a real browser or an e2e runner.
  const fetchOriginal = fetch;
  vi.stubGlobal("fetch", (url: string | URL, init: RequestInit = {}) =>
    fetchOriginal(url, { ...init, headers: { ...init.headers, cookie } }),
  );
  vi.stubGlobal(
    "WebSocket",
    new Proxy(WebSocket, {
      construct(target, args) {
        // Keep what a caller already set, such as a master key: only the browser proxy is unauthenticated.
        const [url, options] = args as [string, { headers?: Record<string, string> }?];
        return Reflect.construct(target, [
          url,
          { headers: { ...options?.headers, cookie, origin: server.url.origin } },
        ]);
      },
    }),
  );
  const browser = await connect({
    baseUrl: server.url,
    services: [Devices, Workspaces, Terminals],
    reconnect: { initialDelayMs: 10 },
  });
  connections.push(browser);
  await browser.services.ready(context);
  expect(browser.deviceId).toBeDefined();
  const cwd = await mkdtemp(join(tmpdir(), "tandem-device-project-"));
  const workspaceId = await browser.services.use(Workspaces).add({ path: cwd }, context);
  const id = await browser.services.use(Terminals).create({ workspaceId }, context);
  const url = new URL(terminalPath(id), server.url);
  url.protocol = "ws:";
  const terminal = new RawSocket(url, { headers: { cookie, origin: server.url.origin } });
  sockets.push(terminal);
  await new Promise((resolve) => terminal.once("open", resolve));
  const closed = new Promise((resolve) => terminal.once("close", resolve));
  // One transport stub for the whole test. The owner keeps its bearer header, which authorization checks before the
  // cookie, so it needs no separate one.
  const owner = await connect({ baseUrl: server.url, token: server.token, services: [Devices] });
  connections.push(owner);
  await owner.services.ready(context);
  await owner.services.use(Devices).revoke(browser.deviceId as string, context);
  await closed;
  await waitFor(() => browser.status.value?.status === "unauthorized");
});
