import { HEALTH_PATH, type HealthResponse } from "@tandem/contracts";
import { afterEach, expect, test } from "vitest";
import { startServer, type TandemServer } from "../src/server.ts";

let server: TandemServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

test("health endpoint reports ok", async () => {
  server = await startServer({ port: 0 });
  const response = await fetch(new URL(HEALTH_PATH, server.url));
  expect(response.status).toBe(200);
  const body = (await response.json()) as HealthResponse;
  expect(body.status).toBe("ok");
});

test("health reports the tunnel, and says nothing about one when there is none", async () => {
  server = await startServer({ port: 0, tunnelState: () => "connected" });
  const withTunnel = (await (await fetch(new URL(HEALTH_PATH, server.url))).json()) as HealthResponse;
  expect(withTunnel.tunnel).toBe("connected");
  await server.stop();
  server = await startServer({ port: 0, tunnelState: () => undefined });
  const without = (await (await fetch(new URL(HEALTH_PATH, server.url))).json()) as HealthResponse;
  expect("tunnel" in without).toBe(false);
});

test("unknown paths return 404", async () => {
  server = await startServer({ port: 0 });
  const response = await fetch(new URL("/missing", server.url));
  expect(response.status).toBe(404);
});
