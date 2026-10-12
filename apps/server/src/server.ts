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
  IMAGE_PATH,
  type ImageRef,
  PTY_PATH,
  RPC_PATH,
  TOKEN_QUERY_PARAMETER,
} from "@tandem/contracts";
import packageJson from "../package.json" with { type: "json" };
import { bearerToken, createToken, isAllowedOrigin, tokensMatch } from "./auth.ts";
import type { HostedTerminal } from "./hosted-terminal.ts";
import { type ConnectionServices, createServiceHost } from "./rpc-host.ts";
import { TerminalSockets } from "./terminal-sockets.ts";
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
  /** The terminal a `/pty/<id>` connection is for. */
  terminal?: (id: string) => HostedTerminal | undefined;
  /** The image a `/image/...` request is for, as stored: base64 and its type. */
  image?: (ref: ImageRef) => Promise<{ data: string; mimeType: string } | undefined>;
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
  const terminalSockets = new TerminalSockets();
  const http = createServer((request, response) => {
    handleRequest(request, response, { serverId, token, image: options.image }).catch((error: unknown) => {
      onError(error instanceof Error ? error : new Error(String(error)));
      if (!response.headersSent) sendJson(response, 500, { error: "internal" });
      else response.destroy();
    });
  });
  // Both sockets are authorized alike: a terminal is a shell, as much as the agent's tools are.
  http.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const terminal = url.pathname.startsWith(`${PTY_PATH}/`);
    if (url.pathname !== RPC_PATH && !terminal) {
      rejectUpgrade(socket, 404, "Not Found");
    } else if (!tokensMatch(token, url.searchParams.get(TOKEN_QUERY_PARAMETER))) {
      rejectUpgrade(socket, 401, "Unauthorized");
    } else if (!isAllowedOrigin(request.headers.origin, allowedOrigins)) {
      rejectUpgrade(socket, 403, "Forbidden");
    } else if (!terminal) {
      listener.handleUpgrade(request, socket, head);
    } else {
      const id = decodedSegment(url.pathname.slice(PTY_PATH.length + 1));
      const hosted = id === undefined ? undefined : options.terminal?.(id);
      if (hosted === undefined) rejectUpgrade(socket, 404, "Not Found");
      else terminalSockets.handleUpgrade(hosted, request, socket, head);
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
      terminalSockets.close();
      await rpc.close();
      await new Promise<void>((resolve, reject) => {
        http.closeAllConnections();
        http.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

/** The types an image is served as: what browsers show in `<img>`, never anything they would run. */
const SERVED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  server: Pick<StartServerOptions, "image"> & { serverId: string; token: string },
): Promise<void> {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  if (pathname.startsWith(`${IMAGE_PATH}/`)) {
    // Authorized by the header, not a query parameter: the token stays out of URLs, logs, and the browser's history.
    if (!tokensMatch(server.token, bearerToken(request.headers.authorization))) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }
    const ref = imageRefOf(pathname.slice(IMAGE_PATH.length + 1));
    const image = ref === undefined || request.method !== "GET" ? undefined : await server.image?.(ref);
    if (image === undefined || !SERVED_IMAGE_TYPES.has(image.mimeType)) {
      sendJson(response, 404, { error: "not_found" });
      return;
    }
    const body = Buffer.from(image.data, "base64");
    response.writeHead(200, {
      "content-type": image.mimeType,
      "content-length": body.length,
      "x-content-type-options": "nosniff",
      // An entry never changes once written, so neither does its image.
      "cache-control": "private, max-age=31536000, immutable",
    });
    response.end(body);
  } else if (pathname === HEALTH_PATH) {
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

/** `<conversation>/<entry>/<message>/<block>`, each a non-negative whole number. */
function imageRefOf(path: string): ImageRef | undefined {
  const parts = path.split("/");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,15}$/.test(part))) return undefined;
  const [conversationId, entryId, message, block] = parts.map(Number) as [number, number, number, number];
  return { conversationId, entryId, message, block };
}

/** A path segment as it was encoded, or `undefined` for one that is not valid percent-encoding. */
function decodedSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
