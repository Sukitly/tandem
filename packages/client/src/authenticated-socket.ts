/** Node's built-in WebSocket accepts headers; browser sockets use their same-origin HttpOnly cookies. */
export function authenticatedSocket(url: string | URL, token?: string): WebSocket {
  if (token === undefined) return new WebSocket(url);
  // Nonstandard Node extension, confirmed on Node 24. Browser callers must not pass a master key.
  const NodeSocket = WebSocket as unknown as new (
    url: string | URL,
    options: { headers: Record<string, string> },
  ) => WebSocket;
  return new NodeSocket(url, { headers: { authorization: `Bearer ${token}` } });
}
