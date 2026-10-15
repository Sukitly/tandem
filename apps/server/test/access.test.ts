import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BOOTSTRAP_PATH,
  PAIR_CODE_PATH,
  PAIR_PATH,
  PROOF_PATH,
  type ProofResponse,
  RPC_PATH,
  SIGN_OUT_PATH,
} from "@tandem/contracts";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { DeviceSessions } from "../src/device-sessions.ts";
import { HostedTerminal } from "../src/hosted-terminal.ts";
import { publicOrigin, startServer, type TandemServer } from "../src/server.ts";
import type { PublicAccessView, TunnelControl } from "../src/tunnel-control.ts";

/** fetch controls Host itself; use HTTP directly to test the tunnel boundary's forwarded Host. */
function rawHttp(url: URL, headers: Record<string, string>, body?: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: body === undefined ? "GET" : "POST", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(res.headers))
          if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: responseHeaders }));
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}
const servers: TandemServer[] = [];
const sockets: WebSocket[] = [];
const terminals: HostedTerminal[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const server of servers.splice(0)) await server.stop();
  for (const terminal of terminals.splice(0)) terminal.dispose();
});
async function start(options: Parameters<typeof startServer>[0] = {}) {
  const devices = options.devices ?? (await DeviceSessions.load());
  const server = await startServer({ port: 0, ...options, devices });
  servers.push(server);
  const pair = (code: string, extra: Record<string, string> = {}) =>
    fetch(new URL(PAIR_PATH, server.url), {
      method: "POST",
      headers: { origin: server.url.origin, "content-type": "application/json", ...extra },
      body: JSON.stringify({ code }),
    });
  return { server, devices, pair };
}
function socket(
  server: TandemServer,
  headers: Record<string, string>,
  query = "",
  path: string = RPC_PATH,
): Promise<WebSocket | number> {
  const url = new URL(path + query, server.url);
  url.protocol = "ws:";
  const ws = new WebSocket(url, { headers });
  sockets.push(ws);
  ws.on("error", () => {});
  return new Promise((resolve) => {
    ws.once("open", () => resolve(ws));
    ws.once("unexpected-response", (_req, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
  });
}

describe("device authentication at the HTTP boundary", () => {
  test("pairs with a cookie, bootstraps without a JS-visible credential, and accepts that cookie on WebSocket", async () => {
    const { server, pair } = await start();
    const code = server.pair().code;
    const response = await pair(code);
    expect(response.status).toBe(200);
    const set = response.headers.get("set-cookie") as string;
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Strict");
    expect(set).not.toContain("Secure");
    const cookie = set.split(";")[0] as string;
    const bootstrap = await fetch(new URL(BOOTSTRAP_PATH, server.url), { headers: { cookie } });
    expect(await bootstrap.json()).toMatchObject({ serverId: server.serverId, deviceId: expect.any(String) });
    expect(bootstrap.headers.get("set-cookie")).toBeNull();
    const ws = await socket(server, { cookie, origin: server.url.origin });
    expect(ws).toBeInstanceOf(WebSocket);
    expect(await socket(server, { cookie, origin: "https://evil.example" })).toBe(403);
    expect(await socket(server, { cookie })).toBe(403);
    expect((await pair(code)).status).toBe(400);
  });
  test("a token in the URL is not accepted, but a master-key header is", async () => {
    const { server } = await start();
    expect(await socket(server, {}, `?token=${server.token}`)).toBe(401);
    expect(await socket(server, { authorization: `Bearer ${server.token}` })).toBeInstanceOf(WebSocket);
    const unauthorized = await fetch(new URL(BOOTSTRAP_PATH, server.url));
    expect(unauthorized.status).toBe(401);
  });
  test("only the master key may issue launch codes, and signing out invalidates the cookie", async () => {
    const { server, pair } = await start();
    const response = await pair(server.pair().code);
    const cookie = response.headers.get("set-cookie")?.split(";")[0] as string;
    const issued = await fetch(new URL(PAIR_CODE_PATH, server.url), {
      method: "POST",
      headers: { authorization: `Bearer ${server.token}` },
    });
    expect(issued.status).toBe(200);
    expect((await fetch(new URL(PAIR_CODE_PATH, server.url), { method: "POST", headers: { cookie } })).status).toBe(
      403,
    );
    const signedOut = await fetch(new URL(SIGN_OUT_PATH, server.url), {
      method: "POST",
      headers: { cookie, origin: server.url.origin },
    });
    expect(signedOut.status).toBe(200);
    expect(signedOut.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await fetch(new URL(BOOTSTRAP_PATH, server.url), { headers: { cookie } })).status).toBe(401);
  });
  test("revocation closes an already upgraded socket", async () => {
    const { server, pair, devices } = await start();
    const response = await pair(server.pair().code);
    const cookie = response.headers.get("set-cookie")?.split(";")[0] as string;
    const ws = (await socket(server, { cookie, origin: server.url.origin })) as WebSocket;
    const closed = new Promise((resolve) => ws.once("close", resolve));
    await devices.revoke(devices.state.value.devices[0]?.id as string);
    await closed;
    expect((await fetch(new URL(BOOTSTRAP_PATH, server.url), { headers: { cookie } })).status).toBe(401);
  });
  test("rejects a foreign Origin, unconfigured Host, missing JSON, malformed JSON, and oversized pairing body", async () => {
    const { server, pair } = await start();
    expect((await pair(server.pair().code, { origin: "https://evil.example" })).status).toBe(403);
    expect((await rawHttp(server.url, { host: "evil.example" })).status).toBe(403);
    const post = (headers: Record<string, string>, body: string) =>
      fetch(new URL(PAIR_PATH, server.url), {
        method: "POST",
        headers: { origin: server.url.origin, ...headers },
        body,
      });
    expect((await post({}, "code=x")).status).toBe(415);
    expect((await post({ "content-type": "application/json" }, "{")).status).toBe(400);
    expect(
      (await post({ "content-type": "application/json" }, JSON.stringify({ code: "x".repeat(5000) }))).status,
    ).toBe(413);
  });
  test("public HTTPS requests receive Secure cookies without trusting forwarded protocol headers", async () => {
    const { server } = await start({ publicUrl: "https://tandem.example.com" });
    const response = await rawHttp(
      new URL(PAIR_PATH, server.url),
      {
        host: "tandem.example.com",
        origin: "https://tandem.example.com",
        "content-type": "application/json",
      },
      JSON.stringify({ code: server.pair().code }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("; Secure");
  });
  test("marks the cookie Secure from the Origin, so a tunnel that rewrites Host changes nothing", async () => {
    const { server } = await start({ publicUrl: "https://tandem.example.com" });
    // What a tunnel that rewrote the Host header would forward: the Origin is still the public one.
    const rewritten = await rawHttp(
      new URL(PAIR_PATH, server.url),
      {
        host: new URL(server.url).host,
        origin: "https://tandem.example.com",
        "content-type": "application/json",
      },
      JSON.stringify({ code: server.pair().code }),
    );
    expect(rewritten.status).toBe(200);
    expect(rewritten.headers.get("set-cookie")).toContain("; Secure");
    const cookie = rewritten.headers.get("set-cookie")?.split(";")[0] as string;
    // Same-origin GET normally omits Origin; the rewritten Host must not downgrade the existing cookie.
    const bootstrap = await rawHttp(new URL(BOOTSTRAP_PATH, server.url), {
      host: new URL(server.url).host,
      cookie,
    });
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.headers.get("set-cookie")).toBeNull();

    // A request that says it came from somewhere else is not the public origin, whatever Host it addressed.
    const elsewhere = await rawHttp(
      new URL(PAIR_PATH, server.url),
      { host: "tandem.example.com", origin: "http://localhost:5173", "content-type": "application/json" },
      JSON.stringify({ code: server.pair().code }),
    );
    expect(elsewhere.status).toBe(403);
  });
  test("rate limits code redemption after five failures", async () => {
    const { pair } = await start();
    for (let i = 0; i < 5; i++) expect((await pair("wrong")).status).toBe(400);
    const blocked = await pair("wrong");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
  });
  test("anonymous failures cannot prevent valid pairing or recovery through HTTP", async () => {
    const { server, devices, pair } = await start();
    const code = server.pair().code;
    const recovery = (await devices.regenerateRecoveryCodes())[0] as string;
    for (let i = 0; i < 5; i++) await pair("wrong");
    expect((await pair("wrong")).status).toBe(429);
    expect((await pair(code)).status).toBe(200);
    expect((await pair(recovery)).status).toBe(200);
    expect((await pair(code)).status).toBe(429);
    expect((await pair(recovery)).status).toBe(429);
  });
  test.each([RPC_PATH, "/pty/security-test"])("public origin revocation closes and rejects %s", async (path) => {
    const oldOrigin = "https://old.example.com";
    const nextOrigin = "https://next.example.com";
    let changed: ((view: PublicAccessView) => void) | undefined;
    const tunnel = {
      view: { status: "connected", publicUrl: oldOrigin },
      onChange(listener: (view: PublicAccessView) => void) {
        changed = listener;
        return () => {
          changed = undefined;
        };
      },
    } as TunnelControl;
    // The initial CLI origin must not reappear after unpublish either.
    const terminal = new HostedTerminal({
      id: "security-test",
      cwd: await mkdtemp(join(tmpdir(), "tandem-access-pty-")),
      size: { cols: 80, rows: 24 },
      command: ["/bin/sh"],
      onExit: () => {},
    });
    terminals.push(terminal);
    const { server, pair } = await start({
      tunnel,
      publicUrl: oldOrigin,
      terminal: (id) => (id === terminal.id ? terminal : undefined),
    });
    const connect = (headers: Record<string, string>) => socket(server, headers, "", path);
    const paired = await pair(server.pair().code, { origin: oldOrigin });
    const cookie = paired.headers.get("set-cookie")?.split(";")[0] as string;
    const ws = (await connect({ cookie, origin: oldOrigin })) as WebSocket;
    const hostOnly = (await connect({
      host: "old.example.com",
      authorization: `Bearer ${server.token}`,
    })) as WebSocket;
    const closed = Promise.all(
      [ws, hostOnly].map((connection) => new Promise((resolve) => connection.once("close", resolve))),
    );
    changed?.({ status: "connected", publicUrl: nextOrigin });
    await closed;
    expect(await connect({ cookie, origin: oldOrigin })).toBe(403);
    expect(await connect({ host: "old.example.com", authorization: `Bearer ${server.token}` })).toBe(403);
    expect((await rawHttp(server.url, { host: "old.example.com" })).status).toBe(403);
    expect((await pair(server.pair().code, { origin: oldOrigin })).status).toBe(403);
    const current = (await connect({ cookie, origin: nextOrigin })) as WebSocket;
    expect(current).toBeInstanceOf(WebSocket);
    const currentClosed = new Promise((resolve) => current.once("close", resolve));
    const code = await fetch(new URL(PAIR_CODE_PATH, server.url), {
      method: "POST",
      headers: { authorization: `Bearer ${server.token}` },
    });
    expect((await code.json()).publicUrl).toBe(nextOrigin);
    changed?.({ status: "none" });
    await currentClosed;
    expect(server.pair().publicUrl).toBeUndefined();
    expect(await connect({ cookie, origin: nextOrigin })).toBe(403);
    expect((await rawHttp(server.url, { host: "next.example.com" })).status).toBe(403);
    expect((await rawHttp(server.url, { host: "old.example.com" })).status).toBe(403);
    // Local access remains available after removing the public origin.
    expect(await connect({ cookie, origin: server.url.origin })).toBeInstanceOf(WebSocket);
  });

  test("binding to 0.0.0.0 resolves server.url to 127.0.0.1 and excludes 0.0.0.0 from allowed origins", async () => {
    const { server, pair } = await start({ hostname: "0.0.0.0" });
    expect(server.url.hostname).toBe("127.0.0.1");

    // 0.0.0.0 origin must be refused
    const disallowedRes = await pair(server.pair().code, { origin: `http://0.0.0.0:${server.url.port}` });
    expect(disallowedRes.status).toBe(403);

    // 127.0.0.1 and localhost origins must be accepted
    const allowedRes = await pair(server.pair().code, { origin: server.url.origin });
    expect(allowedRes.status).toBe(200);

    const localhostRes = await pair(server.pair().code, { origin: `http://localhost:${server.url.port}` });
    expect(localhostRes.status).toBe(200);
  });

  test("honors custom allowedOrigins and rejects non-allowed origins", async () => {
    const customOrigin = "http://custom-dev.example.com";
    const { server, pair } = await start({ allowedOrigins: [customOrigin] });

    // Request from configured custom origin is accepted
    const customRes = await pair(server.pair().code, {
      origin: customOrigin,
      host: new URL(customOrigin).host,
    });
    expect(customRes.status).toBe(200);

    // Request from unknown origin is rejected
    const evilRes = await pair(server.pair().code, {
      origin: "http://unauthorized.example.com",
    });
    expect(evilRes.status).toBe(403);
  });
});

describe("built web assets", () => {
  test("serves pages and assets with security headers and rejects traversal and symlinks outside the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-web-"));
    const webRoot = join(root, "web");
    await mkdir(join(webRoot, "assets"), { recursive: true });
    await writeFile(join(webRoot, "index.html"), '<script>console.log("theme")</script>');
    await writeFile(join(webRoot, "assets", "main-hash.js"), "export {}");
    await writeFile(join(root, "secret.txt"), "secret");
    await symlink(join(root, "secret.txt"), join(webRoot, "link.txt"));
    const { server } = await start({ webRoot });
    const html = await fetch(server.url);
    expect(html.status).toBe(200);
    expect(html.headers.get("cache-control")).toBe("no-store");
    expect(html.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(html.headers.get("content-security-policy")).toContain("sha256-");
    expect(html.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await fetch(new URL("/pair", server.url))).status).toBe(200);
    const asset = await fetch(new URL("/assets/main-hash.js", server.url));
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await fetch(new URL("/link.txt", server.url))).status).toBe(404);
    const status = await new Promise<number>((resolve) => {
      const req = httpRequest(server.url, { path: "/..%2fsecret.txt" }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.end();
    });
    expect(status).toBe(404);
  });
  test("reports a missing web build before binding", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-no-web-"));
    await expect(startServer({ port: 0, webRoot: root })).rejects.toThrow(/build is missing/);
  });
});

test("public-url must be a fixed HTTPS origin", () => {
  expect(publicOrigin("https://tandem.example.com/")).toBe("https://tandem.example.com");
  for (const url of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/a",
    "https://example.com/?x=y",
  ])
    expect(() => publicOrigin(url)).toThrow();
});

describe("the launcher's handshake", () => {
  const nonce = "abcdefghijklmnopqrstuvwxyz0123456789";
  const proof = (server: TandemServer, body: unknown, headers: Record<string, string> = {}) =>
    fetch(new URL(PROOF_PATH, server.url), {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  test("proves the master key without the key being sent, so a launcher can tell our server from another listener", async () => {
    const { server } = await start();
    const response = await proof(server, { nonce });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ProofResponse;
    expect(body.serverId).toBe(server.serverId);
    expect(body.proof).toBe(createHmac("sha256", server.token).update(nonce).digest("hex"));
    expect(body.proof).not.toContain(server.token);
  });
  test("refuses a proof request without a usable nonce, or from an origin that is not allowed", async () => {
    const { server } = await start();
    expect((await proof(server, { nonce: "short" })).status).toBe(400);
    expect((await proof(server, { nonce: 42 })).status).toBe(400);
    expect((await proof(server, { nonce }, { origin: "https://evil.example" })).status).toBe(403);
  });
  test("tells a launcher where the page is served, whether this server serves it or not", async () => {
    const { server: dev } = await start({
      allowedOrigins: ["http://127.0.0.1:5173"],
      webEntry: "http://127.0.0.1:5173",
    });
    const asked = (server: TandemServer) =>
      fetch(new URL(PAIR_CODE_PATH, server.url), {
        method: "POST",
        headers: { authorization: `Bearer ${server.token}` },
      });
    expect((await (await asked(dev)).json()).entry).toBe("http://127.0.0.1:5173");
    const root = await mkdtemp(join(tmpdir(), "tandem-web-entry-"));
    await writeFile(join(root, "index.html"), "<html></html>");
    const { server: serving } = await start({ webRoot: root });
    expect((await (await asked(serving)).json()).entry).toBe(serving.url.origin);
    const { server: bare } = await start();
    expect((await (await asked(bare)).json()).entry).toBeUndefined();
  });
});
