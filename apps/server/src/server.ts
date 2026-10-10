import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { DEFAULT_HOST, DEFAULT_PORT, HEALTH_PATH, type HealthResponse } from "@tandem/contracts";
import packageJson from "../package.json" with { type: "json" };

export interface StartServerOptions {
  hostname?: string;
  /** `0` picks a free port. */
  port?: number;
}

export interface TandemServer {
  readonly url: URL;
  stop(): Promise<void>;
}

export async function startServer(options: StartServerOptions = {}): Promise<TandemServer> {
  const hostname = options.hostname ?? DEFAULT_HOST;
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (pathname === HEALTH_PATH) {
      const body: HealthResponse = { status: "ok", version: packageJson.version };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? DEFAULT_PORT, hostname, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: new URL(`http://${hostname}:${port}/`),
    stop: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
