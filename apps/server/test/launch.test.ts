import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { writeJsonFile } from "../src/json-file.ts";
import { pairingUrl, runningPair } from "../src/launch.ts";
import { startServer, type TandemServer } from "../src/server.ts";

const servers: TandemServer[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) await server.stop();
});

test("a pairing link carries only a short-lived code in its fragment", () => {
  const url = pairingUrl("https://tandem.example.com", "code");
  expect(url.href).toBe("https://tandem.example.com/pair#code");
  expect(url.search).toBe("");
});
test("reuses only the running server of the same state directory", async () => {
  const home = await mkdtemp(join(tmpdir(), "tandem-launch-"));
  vi.stubEnv("TANDEM_HOME", home);
  const server = await startServer({ port: 0 });
  servers.push(server);
  const identity = join(home, "server.json");
  expect(await runningPair(server.url)).toBeUndefined();
  await writeJsonFile(identity, { serverId: server.serverId, token: server.token });
  const pair = await runningPair(server.url);
  expect(pair?.code).toMatch(/^[a-f0-9]{32}$/);
  await writeJsonFile(identity, { serverId: "different", token: server.token });
  expect(await runningPair(server.url)).toBeUndefined();
  await writeJsonFile(identity, { serverId: server.serverId, token: "wrong" });
  expect(await runningPair(server.url)).toBeUndefined();
});
