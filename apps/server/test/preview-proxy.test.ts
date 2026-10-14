import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { handlePreviewHttpRequest, handlePreviewUpgrade } from "../src/preview-proxy.ts";

describe("preview proxy", () => {
  let devServer: Server;
  let devPort: number;
  let lastReceivedHeaders: Record<string, string | string[] | undefined> = {};

  beforeEach(async () => {
    lastReceivedHeaders = {};
    devServer = createServer((req, res) => {
      lastReceivedHeaders = { ...req.headers };
      if (req.url === "/hello") {
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'");
        res.setHeader("Set-Cookie", "session=upstream-secret; Path=/");
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("hello from dev server");
      } else if (req.url === "/redirect") {
        res.writeHead(302, { Location: "/hello" });
        res.end();
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    });

    await new Promise<void>((resolve) => {
      devServer.listen(0, "127.0.0.1", () => {
        devPort = (devServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => devServer.close(() => resolve()));
  });

  test("proxies request, strips frame restrictions, strips cookies, and drops upstream set-cookie", async () => {
    const proxyServer = createServer((req, res) => {
      handlePreviewHttpRequest({
        request: req,
        response: res,
        targetPort: devPort,
        targetPath: "/hello",
        isSubpath: true,
      });
    });

    await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
    const proxyPort = (proxyServer.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/preview/${devPort}/hello`, {
        headers: {
          Cookie: "tandem_auth=secret_token",
        },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello from dev server");
      // Upstream dev server must not see the client's auth cookie
      expect(lastReceivedHeaders.cookie).toBeUndefined();
      // Upstream set-cookie must not leak to client on subpath
      expect(res.headers.get("set-cookie")).toBeNull();
      // Frame restrictions stripped
      expect(res.headers.get("x-frame-options")).toBeNull();
      const csp = res.headers.get("content-security-policy");
      expect(csp).toBe("default-src 'self'");
    } finally {
      await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    }
  });

  test("rewrites redirect location on subpath mode", async () => {
    const proxyServer = createServer((req, res) => {
      handlePreviewHttpRequest({
        request: req,
        response: res,
        targetPort: devPort,
        targetPath: "/redirect",
        isSubpath: true,
      });
    });

    await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
    const proxyPort = (proxyServer.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/preview/${devPort}/redirect`, {
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/preview/${devPort}/hello`);
    } finally {
      await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    }
  });

  test("returns 502 when dev server is unreachable", async () => {
    const unreachablePort = 65432;
    const proxyServer = createServer((req, res) => {
      handlePreviewHttpRequest({
        request: req,
        response: res,
        targetPort: unreachablePort,
        targetPath: "/",
        isSubpath: true,
      });
    });

    await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
    const proxyPort = (proxyServer.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/preview/${unreachablePort}/`);
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(text).toContain("Development Server Not Reachable");
    } finally {
      await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    }
  });

  test("proxies websocket upgrade requests and rewrites origin", async () => {
    // Start a mock upstream WebSocket server (e.g. Vite HMR server)
    const wssServer = createServer();
    const wss = new WebSocketServer({ server: wssServer });
    let receivedOrigin = "";

    wss.on("connection", (ws, req) => {
      receivedOrigin = (req.headers.origin as string) ?? "";
      ws.on("message", (msg) => {
        ws.send(`echo:${msg.toString()}`);
      });
    });

    await new Promise<void>((resolve) => wssServer.listen(0, "127.0.0.1", resolve));
    const wsPort = (wssServer.address() as AddressInfo).port;

    // Start proxy server handling upgrade
    const proxyServer = createServer();
    proxyServer.on("upgrade", (req, socket, head) => {
      handlePreviewUpgrade({
        request: req,
        socket,
        head,
        targetPort: wsPort,
        targetPath: "/ws",
      });
    });

    await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
    const proxyPort = (proxyServer.address() as AddressInfo).port;

    try {
      const client = new WebSocket(`ws://127.0.0.1:${proxyPort}/preview/${wsPort}/ws`, {
        headers: {
          Origin: "https://tandem.example.com",
        },
      });

      const messagePromise = new Promise<string>((resolve, reject) => {
        client.on("open", () => client.send("ping"));
        client.on("message", (data) => resolve(data.toString()));
        client.on("error", reject);
      });

      const received = await messagePromise;
      expect(received).toBe("echo:ping");
      // Origin header must be rewritten to target host for HMR compatibility
      expect(receivedOrigin).toBe(`http://127.0.0.1:${wsPort}`);

      client.close();
    } finally {
      await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
      await new Promise<void>((resolve) => wss.close(() => wssServer.close(() => resolve())));
    }
  });
});
