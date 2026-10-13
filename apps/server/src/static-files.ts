import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

/** Only the built web directory is served, including after resolving symbolic links. */
export class StaticFiles {
  readonly #root: string;
  readonly #scriptHashes: string[];
  private constructor(root: string, html: string) {
    this.#root = root;
    this.#scriptHashes = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .filter((match) => match[1]?.trim())
      .map(
        (match) =>
          `'sha256-${createHash("sha256")
            .update(match[1] ?? "")
            .digest("base64")}'`,
      );
  }
  static async load(root: string): Promise<StaticFiles> {
    try {
      const canonical = await realpath(root);
      return new StaticFiles(canonical, await readFile(resolve(canonical, "index.html"), "utf8"));
    } catch (error) {
      throw new Error("The web build is missing. Run bun run build first.", { cause: error });
    }
  }
  headers(response: ServerResponse, host: string): void {
    response.setHeader(
      "content-security-policy",
      [
        "default-src 'self'",
        `script-src 'self' 'wasm-unsafe-eval' ${this.#scriptHashes.join(" ")}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data: https: http:",
        "font-src 'self' data:",
        `connect-src 'self' ws://${host} wss://${host}`,
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ].join("; "),
    );
  }
  async serve(pathname: string, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (request.method !== "GET" && request.method !== "HEAD") return false;
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    if (decoded.includes("\0") || decoded.includes("\\")) return false;
    const relative = decoded === "/" || decoded === "/pair" ? "index.html" : decoded.slice(1);
    let file = resolve(this.#root, relative);
    if (!file.startsWith(`${this.#root}${sep}`)) return false;
    try {
      file = await realpath(file);
      if (!file.startsWith(`${this.#root}${sep}`) || !(await stat(file)).isFile()) return false;
      const content = await readFile(file);
      response.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        "content-length": content.length,
        "cache-control": relative.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : content);
      return true;
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
      throw error;
    }
  }
}
