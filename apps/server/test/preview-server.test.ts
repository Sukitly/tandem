import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { startServer, type TandemServer } from "../src/server.ts";
import { PreviewBoard } from "../src/services/preview.ts";

describe("server preview proxy integration", () => {
  let devServer: Server;
  let devPort: number;
  let server: TandemServer;
  let preview: PreviewBoard;

  beforeEach(async () => {
    preview = new PreviewBoard({ checkIntervalMs: 0 });
    devServer = createServer((req, res) => {
      res.setHeader("X-Frame-Options", "DENY");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`dev-echo:${req.url}`);
    });
    await new Promise<void>((resolve) => {
      devServer.listen(0, "127.0.0.1", () => {
        devPort = (devServer.address() as AddressInfo).port;
        resolve();
      });
    });

    server = await startServer({
      port: 0,
      preview,
    });
  });

  afterEach(async () => {
    preview.dispose();
    await server.stop();
    await new Promise<void>((resolve) => devServer.close(() => resolve()));
  });

  test("unauthorized request to preview path is rejected with 401", async () => {
    const res = await fetch(new URL(`/preview/${devPort}/hello`, server.url));
    expect(res.status).toBe(401);
  });

  test("authorized request with master token is proxied to dev server", async () => {
    const res = await fetch(new URL(`/preview/${devPort}/hello?query=1`, server.url), {
      headers: {
        Authorization: `Bearer ${server.token}`,
      },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("dev-echo:/hello?query=1");
    expect(res.headers.get("x-frame-options")).toBeNull();
  });

  test("authorized request with paired cookie is proxied to dev server", async () => {
    const issued = server.pair();
    const pairRes = await fetch(new URL("/auth/pair", server.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: server.url.origin,
      },
      body: JSON.stringify({ code: issued.code }),
    });
    expect(pairRes.status).toBe(200);
    const cookie = pairRes.headers.get("set-cookie");
    expect(cookie).toBeTruthy();
    const cookieHeader = cookie?.split(";")[0] ?? "";

    const res = await fetch(new URL(`/preview/${devPort}/hello`, server.url), {
      headers: {
        Cookie: cookieHeader,
      },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("dev-echo:/hello");
  });

  test("subdomain request with master token is proxied to dev server", async () => {
    const res = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = httpRequest(
        server.url,
        {
          path: "/hello",
          headers: {
            Host: `${devPort}--${server.url.host}`,
            Authorization: `Bearer ${server.token}`,
          },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text: body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe("dev-echo:/hello");
  });
});
