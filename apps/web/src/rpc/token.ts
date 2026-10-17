/** Migration only: no browser credential is read from URLs or localStorage anymore. */
export function clearLegacyToken(): void {
  try {
    localStorage.removeItem("tandem.token");
  } catch {
    /* Migration must not prevent cookie authentication. */
  }
  const url = new URL(window.location.href);
  if (url.searchParams.has("token")) {
    url.searchParams.delete("token");
    window.history.replaceState(window.history.state, "", url);
  }
}
