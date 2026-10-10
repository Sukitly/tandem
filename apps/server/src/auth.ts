import { randomBytes, timingSafeEqual } from "node:crypto";

/** A random session token, safe to put in URLs. */
export function createToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokensMatch(expected: string, received: string | null | undefined): boolean {
  if (received === null || received === undefined) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The token of an `Authorization: Bearer <token>` header. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer (\S+)$/);
  return match?.[1];
}

/**
 * Browsers always send `Origin` with WebSocket and cross-origin requests, so a present origin must be allowed. Clients
 * that are not browsers send none and are authorized by the token alone.
 */
export function isAllowedOrigin(origin: string | undefined, allowed: ReadonlySet<string>): boolean {
  return origin === undefined || allowed.has(origin);
}
