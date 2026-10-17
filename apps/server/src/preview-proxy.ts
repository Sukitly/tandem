import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { connect as netConnect } from "node:net";
import type { Duplex } from "node:stream";
import { PREVIEW_SANDBOX_TOKENS } from "@tandem/contracts";

/** Enforced on responses too: opening a preview outside its iframe must not grant it Tandem's origin. */
export const PREVIEW_SANDBOX = `sandbox ${PREVIEW_SANDBOX_TOKENS.join(" ")}`;

export const DANGEROUS_PORTS = new Set([
  22, // SSH
  25, // SMTP
  53, // DNS
  631, // CUPS
  2375, // Docker plain
  2376, // Docker TLS
  3306, // MySQL
  5432, // Postgres
  6379, // Redis
  9229, // Node inspector
  10250, // Kubelet
  11211, // Memcached
  27017, // MongoDB
]);

export interface PreviewHttpOptions {
  request: IncomingMessage;
  response: ServerResponse;
  targetPort: number;
  targetPath: string;
  isSubpath?: boolean;
  onError?: (error: Error) => void;
}

export interface PreviewUpgradeOptions {
  request: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  targetPort: number;
  targetPath: string;
  onError?: (error: Error) => void;
}

/**
 * Forwards an HTTP request to a local development server running on 127.0.0.1:targetPort.
 */
export function handlePreviewHttpRequest(options: PreviewHttpOptions): void {
  const { request, response, targetPort, targetPath, isSubpath = false, onError } = options;
  response.setHeader("Content-Security-Policy", PREVIEW_SANDBOX);

  const headers: Record<string, string | string[] | undefined> = { ...request.headers };
  delete headers.host;
  delete headers.connection;
  delete headers["keep-alive"];
  delete headers["transfer-encoding"];
  // Strip credentials from upstream dev servers to protect Tandem session tokens
  delete headers.cookie;
  delete headers.authorization;
  delete headers["proxy-authorization"];

  headers.host = `127.0.0.1:${targetPort}`;
  headers["x-forwarded-host"] = request.headers.host ?? "";
  headers["x-forwarded-proto"] = (request.headers["x-forwarded-proto"] as string) ?? "http";
  if (request.socket.remoteAddress) {
    headers["x-forwarded-for"] = request.socket.remoteAddress;
  }

  const proxyReq = httpRequest(
    {
      host: "127.0.0.1",
      port: targetPort,
      path: targetPath,
      method: request.method,
      headers,
    },
    (proxyRes) => {
      const responseHeaders = { ...proxyRes.headers };

      // Strip frame restrictions to allow in-app preview iframe
      delete responseHeaders["x-frame-options"];
      // Strip upstream cookies to prevent dev servers from polluting Tandem origin cookies
      delete responseHeaders["set-cookie"];
      responseHeaders["x-content-type-options"] = "nosniff";

      const upstreamCsp = responseHeaders["content-security-policy"];
      const policies = upstreamCsp === undefined ? [] : Array.isArray(upstreamCsp) ? upstreamCsp : [upstreamCsp];
      // Separate policies intersect. Never append sandbox as another directive in an upstream policy: an existing
      // sandbox directive (including allow-same-origin) would take precedence over a duplicate directive.
      responseHeaders["content-security-policy"] = [
        ...policies
          .map((policy) =>
            policy
              .split(";")
              .map((part) => part.trim())
              .filter((part) => !/^frame-ancestors(?:\s|$)/i.test(part))
              .join("; "),
          )
          .filter(Boolean),
        PREVIEW_SANDBOX,
      ];

      // Rewrite location headers on subpath mode to prevent breaking out of preview subpath
      if (isSubpath && responseHeaders.location) {
        const loc = responseHeaders.location;
        if (loc.startsWith("/") && !loc.startsWith("//")) {
          responseHeaders.location = `/preview/${targetPort}${loc}`;
        } else {
          try {
            const locUrl = new URL(loc);
            if (
              (locUrl.hostname === "localhost" || locUrl.hostname === "127.0.0.1") &&
              Number(locUrl.port || 80) === targetPort
            ) {
              responseHeaders.location = `/preview/${targetPort}${locUrl.pathname}${locUrl.search}${locUrl.hash}`;
            }
          } catch {
            // Keep original location if unparseable
          }
        }
      }

      response.writeHead(proxyRes.statusCode ?? 200, responseHeaders);
      proxyRes.pipe(response);
    },
  );

  proxyReq.on("error", (err) => {
    onError?.(err);
    if (!response.headersSent) {
      response.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Preview Unavailable</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 2rem; background: #09090b; color: #f4f4f5; }
    .card { max-width: 480px; margin: 2rem auto; padding: 1.5rem; border: 1px solid #27272a; border-radius: 0.5rem; background: #18181b; }
    h1 { font-size: 1.25rem; margin-top: 0; color: #ef4444; }
    p { font-size: 0.875rem; color: #a1a1aa; line-height: 1.5; }
    code { background: #27272a; padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-size: 0.875rem; color: #fafafa; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Development Server Not Reachable</h1>
    <p>Could not connect to port <code>${targetPort}</code> on <code>127.0.0.1</code>.</p>
    <p>Please make sure the development server is running and listening on port ${targetPort}.</p>
  </div>
</body>
</html>`);
    } else {
      response.destroy();
    }
  });

  request.pipe(proxyReq);
}

/**
 * Upgrades a client WebSocket connection to proxy directly to 127.0.0.1:targetPort.
 */
export function handlePreviewUpgrade(options: PreviewUpgradeOptions): void {
  const { request, socket, head, targetPort, targetPath, onError } = options;

  const targetSocket = netConnect({ host: "127.0.0.1", port: targetPort }, () => {
    // Construct forwarded HTTP Upgrade request
    const lines: string[] = [`${request.method ?? "GET"} ${targetPath} HTTP/1.1`];
    for (const [key, value] of Object.entries(request.headers)) {
      const lower = key.toLowerCase();
      if (lower === "host") {
        lines.push(`Host: 127.0.0.1:${targetPort}`);
      } else if (lower === "origin") {
        // Rewrite origin to match target to satisfy Vite HMR / strict dev server origin checks
        lines.push(`Origin: http://127.0.0.1:${targetPort}`);
      } else if (lower === "cookie" || lower === "authorization" || lower === "proxy-authorization") {
      } else if (Array.isArray(value)) {
        for (const item of value) {
          lines.push(`${key}: ${item}`);
        }
      } else if (value !== undefined) {
        lines.push(`${key}: ${value}`);
      }
    }
    // End of HTTP headers is marked by \r\n\r\n
    lines.push("");
    lines.push("");

    targetSocket.write(lines.join("\r\n"));
    if (head && head.length > 0) {
      targetSocket.write(head);
    }

    targetSocket.pipe(socket);
    socket.pipe(targetSocket);
  });

  targetSocket.on("error", (err) => {
    onError?.(err);
    socket.destroy();
  });

  socket.on("error", (err) => {
    onError?.(err);
    targetSocket.destroy();
  });
}
