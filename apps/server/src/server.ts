import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { RemoteServiceProvider } from "@earendil-works/chord";
import { Server } from "@earendil-works/pi-server";
import {
  BOOTSTRAP_PATH,
  type BootstrapResponse,
  DEFAULT_HOST,
  DEFAULT_PORT,
  HEALTH_PATH,
  type HealthResponse,
  RPC_PATH,
  TOKEN_QUERY_PARAMETER,
} from "@tandem/contracts";
import packageJson from "../package.json" with { type: "json" };
import { bearerToken, createToken, isAllowedOrigin, tokensMatch } from "./auth.ts";
import { type ConnectionServices, createServiceHost } from "./rpc-host.ts";
import { WebSocketListener } from "./websocket-listener.ts";

export interface StartServerOptions {
  hostname?: string;
  /** `0` picks a free port. */
  port?: number;
  /** Logical pi-protocol server identity, a lowercase UUIDv4. Generated when absent. */
  serverId?: string;
  /** Session token clients must present. Generated when absent. */
  token?: string;
  /** Browser origins allowed besides the server's own, such as a development server. */
  allowedOrigins?: readonly string[];
  /** Creates the services of each client connection. */
  createConnectionServices?: () => ConnectionServices;
  onError?: (error: Error) => void;
}

export interface TandemServer {
  readonly url: URL;
  readonly serverId: string;
  readonly token: string;
  stop(): Promise<void>;
}

export async function startServer(options: StartServerOptions = {}): Promise<TandemServer> {
  const hostname = options.hostname ?? DEFAULT_HOST;
  const serverId = options.serverId ?? randomUUID();
  const token = options.token ?? createToken();
  const onError = options.onError ?? (() => {});
  const createConnectionServices =
    options.createConnectionServices ?? (() => ({ provider: new RemoteServiceProvider([]) }));

  const listener = new WebSocketListener({ onError });
  const rpc = new Server(createServiceHost(createConnectionServices), { listeners: [listener], serverId, onError });
  await rpc.start();

  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const http = createServer((request, response) => handleRequest(request, response, { serverId, token }));
  http.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== RPC_PATH) {
      rejectUpgrade(socket, 404, "Not Found");
    } else if (!tokensMatch(token, url.searchParams.get(TOKEN_QUERY_PARAMETER))) {
      rejectUpgrade(socket, 401, "Unauthorized");
    } else if (!isAllowedOrigin(request.headers.origin, allowedOrigins)) {
      rejectUpgrade(socket, 403, "Forbidden");
    } else {
      listener.handleUpgrade(request, socket, head);
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(options.port ?? DEFAULT_PORT, hostname, () => {
        http.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await rpc.close();
    throw error;
  }
  const { port } = http.address() as AddressInfo;
  for (const host of [hostname, "localhost"]) allowedOrigins.add(`http://${host}:${port}`);

  return {
    url: new URL(`http://${hostname}:${port}/`),
    serverId,
    token,
    async stop() {
      await rpc.close();
      await new Promise<void>((resolve, reject) => {
        http.closeAllConnections();
        http.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  server: { serverId: string; token: string },
): void {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  if (pathname === HEALTH_PATH) {
    const body: HealthResponse = { status: "ok", version: packageJson.version };
    sendJson(response, 200, body);
  } else if (pathname === BOOTSTRAP_PATH) {
    if (tokensMatch(server.token, bearerToken(request.headers.authorization))) {
      const body: BootstrapResponse = { serverId: server.serverId };
      sendJson(response, 200, body);
    } else {
      sendJson(response, 401, { error: "unauthorized" });
    }
  } else {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
