import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAIR_CODE_PATH, PROOF_PATH } from "@tandem/contracts";
import { afterEach, expect, test, vi } from "vitest";
import { writeJsonFile } from "../src/json-file.ts";
import { pairingUrl, runningPair } from "../src/launch.ts";
import { startServer, type TandemServer } from "../src/server.ts";

const servers: TandemServer[] = [];
const listeners: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) await server.stop();
  await Promise.all(
    listeners.splice(0).map((listener) => new Promise<void>((resolve) => listener.close(() => resolve()))),
  );
});

interface Seen {
  readonly url: string | undefined;
  readonly authorization: string | undefined;
  readonly body: string;
}

/** A listener that stands in for whatever else may hold the port: it answers, but it is not our server. */
async function impostor(
  answer: (seen: Seen, response: ServerResponse, token: string) => void,
  token: string,
): Promise<{ url: URL; seen: Seen[] }> {
  const seen: Seen[] = [];
  const listener = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const entry = { url: request.url, authorization: request.headers.authorization, body };
      seen.push(entry);
      answer(entry, response, token);
    });
  });
  listeners.push(listener);
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  return { url: new URL(`http://127.0.0.1:${(listener.address() as AddressInfo).port}`), seen };
}

async function identityFile(serverId: string, token: string): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "tandem-launch-"));
  vi.stubEnv("TANDEM_HOME", home);
  await writeJsonFile(join(home, "server.json"), { serverId, token });
}

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
  expect(pair?.entry).toBeUndefined();
  await writeJsonFile(identity, { serverId: "different", token: server.token });
  expect(await runningPair(server.url)).toBeUndefined();
  await writeJsonFile(identity, { serverId: server.serverId, token: "wrong" });
  expect(await runningPair(server.url)).toBeUndefined();
});

test("never sends the installation key to whatever else holds the port", async () => {
  await identityFile("installation", "master-key");
  const { url, seen } = await impostor((_entry, response) => {
    response.writeHead(404, { "content-type": "application/json" });
    response.end("{}");
  }, "master-key");
  expect(await runningPair(url)).toBeUndefined();
  expect(seen.length).toBe(1);
  expect(seen[0]?.url).toBe(PROOF_PATH);
  expect(seen.map((entry) => entry.authorization)).toEqual([undefined]);
});

test("proves the key before giving it, so a listener that answers the proof is then trusted", async () => {
  await identityFile("installation", "master-key");
  const { url, seen } = await impostor((entry, response, token) => {
    if (entry.url !== PROOF_PATH) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end("{}");
      return;
    }
    const { nonce } = JSON.parse(entry.body) as { nonce: string };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ serverId: "installation", proof: createHmac("sha256", token).update(nonce).digest("hex") }),
    );
  }, "master-key");
  await expect(runningPair(url)).rejects.toThrow(/another Tandem, or a version without pairing codes/);
  // The key goes only to a listener that has just proved it holds that same key.
  expect(seen.at(-1)?.url).toBe(PAIR_CODE_PATH);
  expect(seen.at(-1)?.authorization).toBe("Bearer master-key");
});

test("reports where a browser must open the page when the server does not serve it", async () => {
  const home = await mkdtemp(join(tmpdir(), "tandem-launch-"));
  vi.stubEnv("TANDEM_HOME", home);
  const server = await startServer({
    port: 0,
    allowedOrigins: ["http://127.0.0.1:5173"],
    webEntry: "http://127.0.0.1:5173",
  });
  servers.push(server);
  await writeJsonFile(join(home, "server.json"), { serverId: server.serverId, token: server.token });
  expect((await runningPair(server.url))?.entry).toBe("http://127.0.0.1:5173");
});
