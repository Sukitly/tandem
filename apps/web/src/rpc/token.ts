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
    localStorage.setItem(STORAGE_KEY, fromUrl);
    url.searchParams.delete(TOKEN_QUERY_PARAMETER);
    window.history.replaceState(window.history.state, "", url);
    return fromUrl;
  }
  return localStorage.getItem(STORAGE_KEY) ?? undefined;
}

export function forgetToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}
