import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";

export const PREVIEW_PATH = "/preview";

/** A port on the host machine available for web application preview. */
export interface PreviewPort {
  readonly port: number;
  readonly label?: string;
  readonly detectedAt: number;
}

export interface PreviewState {
  readonly ports: PreviewPort[];
}

export interface RegisterPortInput {
  readonly port: number;
  readonly label?: string;
}

export interface UnregisterPortInput {
  readonly port: number;
}

/**
 * Service managing preview ports for running web applications and dev servers.
 */
export interface Preview {
  readonly state: ReplicatedState<PreviewState>;
  register(input: RegisterPortInput, context: Context): Promise<void>;
  unregister(input: UnregisterPortInput, context: Context): Promise<void>;
}

export const Preview = defineService<Preview>("tandem.preview");

/** The subpath URL for a given preview port. */
export function previewPath(port: number): string {
  return `${PREVIEW_PATH}/${port}/`;
}

/**
 * Constructs a preview URL given a base URL, a port, and optional preference for subdomain routing.
 */
export function previewUrl(options: { port: number; baseUrl: string; useSubdomain?: boolean }): string {
  const { port, baseUrl, useSubdomain = false } = options;
  const parsed = new URL(baseUrl);
  if (useSubdomain && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    parsed.hostname = `${port}--${parsed.hostname}`;
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  }
  const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${cleanBase}${previewPath(port)}`;
}

/**
 * Parses an incoming HTTP request to determine if it targets a preview port, via either
 * subdomain pattern (e.g. 5173--tandem.example.com) or subpath pattern (e.g. /preview/5173/...).
 */
export function parsePreviewTarget(
  hostHeader: string | undefined,
  requestUrl: string,
  allowedHosts: ReadonlySet<string>,
): { port: number; path: string } | undefined {
  const url = new URL(requestUrl, "http://localhost");
  const pathWithSearch = `${url.pathname}${url.search}`;

  // 1. Check subdomain pattern: <port>--<baseHost>
  if (hostHeader) {
    const subdomainMatch = /^(\d{2,5})--(.+)$/.exec(hostHeader);
    if (subdomainMatch?.[1] && subdomainMatch[2]) {
      const port = Number.parseInt(subdomainMatch[1], 10);
      const baseHost = subdomainMatch[2];
      const baseHostWithoutPort = baseHost.split(":")[0] ?? "";
      if (port >= 1 && port <= 65535 && (allowedHosts.has(baseHost) || allowedHosts.has(baseHostWithoutPort))) {
        return { port, path: pathWithSearch };
      }
    }
  }

  // 2. Check subpath pattern: /preview/<port>(/.*)?
  const subpathMatch = /^\/preview\/(\d{2,5})(\/.*)?$/.exec(url.pathname);
  if (subpathMatch?.[1]) {
    const port = Number.parseInt(subpathMatch[1], 10);
    if (port >= 1 && port <= 65535) {
      const rest = (subpathMatch[2] ?? "/") + url.search;
      return { port, path: rest };
    }
  }

  return undefined;
}
