import { TOKEN_QUERY_PARAMETER } from "@tandem/contracts";

const STORAGE_KEY = "tandem.token";

/**
 * The session token: taken from the URL the server printed, then kept in this origin's storage so that reloads and
 * new tabs work. It is removed from the address bar so that it does not end up in history or screenshots.
 */
export function readToken(): string | undefined {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get(TOKEN_QUERY_PARAMETER);
  if (fromUrl !== null && fromUrl !== "") {
    url.searchParams.delete(TOKEN_QUERY_PARAMETER);
    window.history.replaceState(window.history.state, "", url);
    if (!isWellFormed(fromUrl)) return undefined;
    localStorage.setItem(STORAGE_KEY, fromUrl);
    return fromUrl;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null || isWellFormed(stored)) return stored ?? undefined;
  forgetToken();
  return undefined;
}

/**
 * The server's tokens are base64url. Anything else, such as a URL copied with a character after it, cannot be sent in
 * a header at all, so it is treated as no token rather than as a failure to connect.
 */
function isWellFormed(token: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(token);
}

export function forgetToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}
