/** Migration only: no browser credential is read from URLs or localStorage anymore. */
export function clearLegacyToken(): void {
  localStorage.removeItem("tandem.token");
  const url = new URL(window.location.href);
  if (url.searchParams.has("token")) {
    url.searchParams.delete("token");
    window.history.replaceState(window.history.state, "", url);
  }
}
