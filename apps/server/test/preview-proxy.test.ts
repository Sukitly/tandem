import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { handlePreviewHttpRequest } from "../src/preview-proxy.ts";

describe("preview proxy", () => {
  let devServer: Server;
  let devPort: number;

  beforeEach(async () => {
    devServer = createServer((req, res) => {
      if (req.url === "/hello") {
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'");
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

  test("proxies request and strips frame restrictions", async () => {
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
      const res = await fetch(`http://127.0.0.1:${proxyPort}/preview/${devPort}/hello`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello from dev server");
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
});
