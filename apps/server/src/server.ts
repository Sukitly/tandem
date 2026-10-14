import { createHmac, randomUUID } from "node:crypto";
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
  PAIR_CODE_PATH,
  PAIR_PATH,
  type PairingCode,
  PREVIEW_PATH,
  PROOF_PATH,
  type ProofRequest,
  type ProofResponse,
  PTY_PATH,
  parsePreviewTarget,
  RPC_PATH,
  SIGN_OUT_PATH,
  type TunnelState,
} from "@tandem/contracts";
import packageJson from "../package.json" with { type: "json" };
import { bearerToken, createToken, isAllowedOrigin, tokensMatch } from "./auth.ts";
import { DeviceSessions, deviceName, PairingError } from "./device-sessions.ts";
import type { HostedTerminal } from "./hosted-terminal.ts";
import { DANGEROUS_PORTS, handlePreviewHttpRequest, handlePreviewUpgrade } from "./preview-proxy.ts";
import { type ConnectionServices, createServiceHost } from "./rpc-host.ts";
import type { PreviewBoard } from "./services/preview.ts";
import { StaticFiles } from "./static-files.ts";
import { TerminalSockets } from "./terminal-sockets.ts";
import type { TunnelControl } from "./tunnel-control.ts";
import { WebSocketListener } from "./websocket-listener.ts";

export interface StartServerOptions {
  hostname?: string;
  port?: number;
  serverId?: string;
  /** Installation master key; never passed to the browser. */
  token?: string;
  allowedOrigins?: readonly string[];
  publicUrl?: string;
  /** Origin a browser opens the page at, when this server does not serve it, as in development. */
  webEntry?: string;
  webRoot?: string;
  devices?: DeviceSessions;
  /** Where the tunnel this installation runs has got to, for `/health`. */
  tunnelState?: () => TunnelState | undefined;
  tunnel?: TunnelControl;
  createConnectionServices?: () => ConnectionServices;
  terminal?: (id: string) => HostedTerminal | undefined;
  preview?: PreviewBoard;
  image?: (ref: ImageRef) => Promise<{ data: string; mimeType: string } | undefined>;
  onError?: (error: Error) => void;
}
export interface TandemServer {
  readonly url: URL;
  readonly serverId: string;
  readonly token: string;
  readonly publicUrl?: string;
  pair(): PairingCode;
  stop(): Promise<void>;
}

export async function startServer(options: StartServerOptions = {}): Promise<TandemServer> {
  const hostname = options.hostname ?? DEFAULT_HOST;
  const serverId = options.serverId ?? randomUUID();
  const token = options.token ?? createToken();
  const onError = options.onError ?? (() => {});
  const devices = options.devices ?? (await DeviceSessions.load());
  const web = options.webRoot === undefined ? undefined : await StaticFiles.load(options.webRoot);
  const publicUrl = options.publicUrl === undefined ? undefined : publicOrigin(options.publicUrl);
  const cookieName = `tandem_${serverId}`;
  let ownOrigin: string | undefined;
  const allowedOrigins = new Set(
    (options.allowedOrigins ?? []).map((value) => {
      const url = new URL(value);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new Error("allowedOrigins must contain HTTP or HTTPS origins");
      return url.origin;
    }),
  );
  const hosts = new Set<string>();
  let ownPort: number | undefined;
  const isBlockedPort = (targetPort: number): boolean => {
    if (ownPort !== undefined && targetPort === ownPort) return true;
    if (DANGEROUS_PORTS.has(targetPort)) return true;
    return options.preview?.isIgnored(targetPort) ?? false;
  };
  // Explicit local/development origins are stable; the tunnel contributes exactly one replaceable public origin.
  const fixedOrigins = new Set(allowedOrigins);
  let activePublicUrl = options.tunnel?.view.publicUrl ?? publicUrl;
  const upgraded = new Map<Duplex, { host: string; origin: string | undefined }>();
  const updateOrigins = (): void => {
    allowedOrigins.clear();
    hosts.clear();
    for (const origin of fixedOrigins) allowedOrigins.add(origin);
    if (activePublicUrl !== undefined) allowedOrigins.add(publicOrigin(activePublicUrl));
    for (const origin of allowedOrigins) hosts.add(new URL(origin).host);
    for (const [socket, source] of upgraded) {
      if (!hosts.has(source.host) || !isAllowedOrigin(source.origin, allowedOrigins)) socket.destroy();
    }
  };
  updateOrigins();
  const stopOrigins = options.tunnel?.onChange((view) => {
    activePublicUrl = view.publicUrl;
    updateOrigins();
  });
  const currentPublicUrl = (): string | undefined => activePublicUrl;
  const sockets = new Map<string, Set<Duplex>>();
  const stopRevocations = devices.onRevoke((id) => {
    for (const socket of sockets.get(id) ?? []) socket.destroy();
    sockets.delete(id);
  });
  const listener = new WebSocketListener({ onError });
  const rpc = new Server(
    createServiceHost(options.createConnectionServices ?? (() => ({ provider: new RemoteServiceProvider([]) }))),
    {
      listeners: [listener],
      serverId,
      onError,
    },
  );
  await rpc.start();
  const terminalSockets = new TerminalSockets();

  const acceptable = (request: IncomingMessage): boolean =>
    hosts.has(request.headers.host ?? "") && isAllowedOrigin(request.headers.origin, allowedOrigins);
  const acceptablePreview = (request: IncomingMessage): boolean =>
    hosts.has(request.headers.host ?? "") &&
    (request.headers.origin === "null" || isAllowedOrigin(request.headers.origin, allowedOrigins));
  const authorize = async (request: IncomingMessage): Promise<{ master: boolean; deviceId?: string } | undefined> => {
    if (tokensMatch(token, bearerToken(request.headers.authorization))) return { master: true };
    const device = await devices.authenticate(cookie(request, cookieName));
    return device === undefined ? undefined : { master: false, deviceId: device.id };
  };
  const sessionCookie = (request: IncomingMessage, secret: string, clear = false): string => {
    const pub = currentPublicUrl();
    const secure = pub !== undefined && cameFromPublicOrigin(request, pub);
    // Fixed browser lifetime; authentication separately enforces 30 days without activity server-side.
    return `${cookieName}=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : 400 * 24 * 60 * 60}${secure ? "; Secure" : ""}`;
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("cross-origin-resource-policy", "same-origin");
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    const previewTarget = parsePreviewTarget(request.headers.host, request.url ?? "/", hosts);
    if (previewTarget !== undefined) {
      if (!acceptablePreview(request)) return sendJson(response, 403, { error: "forbidden" });
      const auth = await authorize(request);
      if (auth === undefined) return sendJson(response, 401, { error: "unauthorized" });
      if (isBlockedPort(previewTarget.port)) return sendJson(response, 403, { error: "forbidden" });
      const isSubpath = pathname.startsWith(PREVIEW_PATH);
      handlePreviewHttpRequest({
        request,
        response,
        targetPort: previewTarget.port,
        targetPath: previewTarget.path,
        isSubpath,
        onError,
      });
      return;
    }
    if (!acceptable(request)) return sendJson(response, 403, { error: "forbidden" });
    web?.headers(response, request.headers.host ?? "");
    if (pathname === HEALTH_PATH) {
      const tunnel = options.tunnelState?.();
      const body: HealthResponse = {
        status: "ok",
        version: packageJson.version,
        ...(tunnel === undefined ? {} : { tunnel }),
      };
      return sendJson(response, 200, body);
    }
    if (pathname === PROOF_PATH && request.method === "POST") {
      const input = await readBody(request);
      const nonce = (input as Partial<ProofRequest> | null)?.nonce;
      if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce))
        return sendJson(response, 400, { error: "A nonce is required" });
      // The master key proves itself without being sent: a listener that cannot answer is never given it.
      const body: ProofResponse = { serverId, proof: createHmac("sha256", token).update(nonce).digest("hex") };
      return sendJson(response, 200, body);
    }
    if (pathname === PAIR_PATH && request.method === "POST") {
      // A browser POST must come from an explicitly configured origin, never merely a matching Host.
      if (request.headers.origin === undefined)
        return sendJson(response, 403, { error: "An allowed Origin is required" });
      const input = await readBody(request);
      if (input === null || typeof input !== "object" || typeof (input as { code?: unknown }).code !== "string")
        return sendJson(response, 400, { error: "A pairing or recovery code is required" });
      const { secret } = await devices.redeem(
        (input as { code: string }).code,
        deviceName(request.headers["user-agent"]),
      );
      if (!acceptable(request)) return sendJson(response, 403, { error: "forbidden" });
      response.setHeader("set-cookie", sessionCookie(request, secret));
      return sendJson(response, 200, { paired: true });
    }
    if ([BOOTSTRAP_PATH, PAIR_CODE_PATH, SIGN_OUT_PATH].includes(pathname) || pathname.startsWith(`${IMAGE_PATH}/`)) {
      const auth = await authorize(request);
      if (!acceptable(request)) return sendJson(response, 403, { error: "forbidden" });
      if (auth === undefined) return sendJson(response, 401, { error: "unauthorized" });
      if (pathname === BOOTSTRAP_PATH && request.method === "GET") {
        const body: BootstrapResponse = {
          serverId,
          ...(auth.deviceId === undefined ? {} : { deviceId: auth.deviceId }),
        };
        // Do not rewrite cookies on GET: Origin may be absent and a tunnel may rewrite Host. Reconstructing
        // cookie attributes here could downgrade a public Secure cookie. Pairing sets its fixed lifetime.
        return sendJson(response, 200, body);
      }
      if (pathname === PAIR_CODE_PATH && request.method === "POST") {
        if (!auth.master) return sendJson(response, 403, { error: "The installation master key is required" });
        const issued = devices.issue(currentPublicUrl());
        // Where a launcher that reuses this server must open the browser: its own page, or the one configured for it.
        const entry = options.webEntry ?? (web === undefined ? undefined : ownOrigin);
        return sendJson(response, 200, entry === undefined ? issued : { ...issued, entry });
      }
      if (pathname === SIGN_OUT_PATH && request.method === "POST") {
        if (request.headers.origin === undefined)
          return sendJson(response, 403, { error: "An allowed Origin is required" });
        if (auth.deviceId !== undefined) await devices.revoke(auth.deviceId);
        response.setHeader("set-cookie", sessionCookie(request, "", true));
        return sendJson(response, 200, { signedOut: true });
      }
      if (pathname.startsWith(`${IMAGE_PATH}/`) && request.method === "GET") {
        const ref = imageRefOf(pathname.slice(IMAGE_PATH.length + 1), serverId);
        const image = ref === undefined ? undefined : await options.image?.(ref);
        if (image === undefined || !SERVED_IMAGE_TYPES.has(image.mimeType))
          return sendJson(response, 404, { error: "not_found" });
        const body = Buffer.from(image.data, "base64");
        response.writeHead(200, {
          "content-type": image.mimeType,
          "content-length": body.length,
          "cache-control": "private, max-age=31536000, immutable",
        });
        response.end(body);
        return;
      }
    }
    if (await web?.serve(pathname, request, response)) return;
    sendJson(response, 404, { error: "not_found" });
  };
  const http = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (error instanceof PairingError) {
        if (error.status === 429) response.setHeader("retry-after", "60");
        sendJson(response, error.status, { error: error.message });
      } else {
        onError(error instanceof Error ? error : new Error(String(error)));
        if (!response.headersSent) sendJson(response, 500, { error: "internal" });
        else response.destroy();
      }
    });
  });
  http.on("upgrade", (request, socket, head) => {
    const upgrade = async (): Promise<void> => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const previewTarget = parsePreviewTarget(request.headers.host, request.url ?? "/", hosts);
      if (previewTarget !== undefined) {
        if (!acceptablePreview(request)) return rejectUpgrade(socket, 403, "Forbidden");
        const auth = await authorize(request);
        if (auth === undefined) return rejectUpgrade(socket, 401, "Unauthorized");
        if (!auth.master && request.headers.origin === undefined) return rejectUpgrade(socket, 403, "Forbidden");
        if (isBlockedPort(previewTarget.port)) return rejectUpgrade(socket, 403, "Forbidden");
        handlePreviewUpgrade({
          request,
          socket,
          head,
          targetPort: previewTarget.port,
          targetPath: previewTarget.path,
          onError,
        });
        return;
      }
      const terminal = url.pathname.startsWith(`${PTY_PATH}/`);
      if (url.pathname !== RPC_PATH && !terminal) return rejectUpgrade(socket, 404, "Not Found");
      if (!acceptable(request)) return rejectUpgrade(socket, 403, "Forbidden");
      const auth = await authorize(request);
      if (auth === undefined) return rejectUpgrade(socket, 401, "Unauthorized");
      // Browser cookies require an Origin on upgrades; only explicit bearer clients may omit it.
      if (!auth.master && request.headers.origin === undefined) return rejectUpgrade(socket, 403, "Forbidden");
      // Origins can change while authentication waits for persistent device state.
      if (!acceptable(request)) return rejectUpgrade(socket, 403, "Forbidden");
      upgraded.set(socket, { host: request.headers.host ?? "", origin: request.headers.origin });
      socket.once("close", () => upgraded.delete(socket));
      if (auth.deviceId !== undefined) {
        const id = auth.deviceId;
        const held = sockets.get(id) ?? new Set<Duplex>();
        held.add(socket);
        sockets.set(id, held);
        const release = devices.hold(id);
        socket.once("close", () => {
          void release().catch(onError);
          held.delete(socket);
          if (held.size === 0) sockets.delete(id);
        });
      }
      if (!terminal) listener.handleUpgrade(request, socket, head);
      else {
        const id = decodedSegment(url.pathname.slice(PTY_PATH.length + 1));
        const hosted = id === undefined ? undefined : options.terminal?.(id);
        if (hosted === undefined) rejectUpgrade(socket, 404, "Not Found");
        else terminalSockets.handleUpgrade(hosted, request, socket, head);
      }
    };
    upgrade().catch((error: unknown) => {
      onError(error instanceof Error ? error : new Error(String(error)));
      socket.destroy();
    });
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
    stopRevocations();
    stopOrigins?.();
    terminalSockets.close();
    await rpc.close();
    throw error;
  }
  const { port } = http.address() as AddressInfo;
  ownPort = port;
  options.preview?.ignorePort(port);
  ownOrigin = `http://${hostname}:${port}`;
  for (const host of [hostname, "localhost"]) fixedOrigins.add(`http://${host}:${port}`);
  updateOrigins();
  const activityTimer = setInterval(
    () => {
      void devices.touchActive().catch(onError);
    },
    60 * 60 * 1000,
  );
  activityTimer.unref();
  return {
    url: new URL(`http://${hostname}:${port}/`),
    serverId,
    token,
    publicUrl,
    pair: () => devices.issue(currentPublicUrl()),
    async stop() {
      clearInterval(activityTimer);
      stopRevocations();
      stopOrigins?.();
      terminalSockets.close();
      await rpc.close();
      await new Promise<void>((resolve, reject) => {
        http.closeAllConnections();
        http.close((error) => (error ? reject(error) : resolve()));
      });
      await devices.flush();
    },
  };
}

/**
 * Whether the browser reached this server through the public origin. A tunnel in front may rewrite `Host`, so the
 * answer comes from `Origin`, which the browser sets and cannot set to anything but where it is running. Only a
 * request that sets no `Origin` at all — a navigation — is judged by the `Host` it addressed.
 */
export function cameFromPublicOrigin(request: IncomingMessage, publicUrl: string): boolean {
  const origin = request.headers.origin;
  if (origin !== undefined) return origin === publicUrl;
  return request.headers.host === new URL(publicUrl).host;
}

const SERVED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
function cookie(request: IncomingMessage, name: string): string | undefined {
  return request.headers.cookie
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
export function publicOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("public-url must be an HTTPS origin, for example https://tandem.example.com");
  return url.origin;
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new PairingError("Use application/json", 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new PairingError("Request body is too large", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PairingError("Invalid JSON");
  }
}
function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
function imageRefOf(path: string, serverId: string): ImageRef | undefined {
  const [server, ...rest] = path.split("/");
  if (
    server === undefined ||
    decodedSegment(server) !== serverId ||
    rest.length !== 4 ||
    !rest.every((part) => /^\d{1,15}$/.test(part))
  )
    return undefined;
  const [conversationId, entryId, messageIndex, blockIndex] = rest.map(Number) as [number, number, number, number];
  return { conversationId, entryId, messageIndex, blockIndex };
}
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
