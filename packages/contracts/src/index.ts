/**
 * Contracts shared by the Tandem server and its clients.
 *
 * Everything exported here must run in both Node/Bun and the browser: no runtime-specific imports.
 */

/** The server only listens on the loopback interface. */
export const DEFAULT_HOST = "127.0.0.1";

export const DEFAULT_PORT = 4820;

/** WebSocket path carrying pi-protocol frames (service calls and replicated state). */
export const RPC_PATH = "/rpc";

/** WebSocket path prefix for raw terminal byte streams: `${PTY_PATH}/<terminalId>`. */
export const PTY_PATH = "/pty";

export const HEALTH_PATH = "/health";

/**
 * Returns what a client needs before it can connect to `RPC_PATH`. Requires the session token as a bearer token.
 */
export const BOOTSTRAP_PATH = "/bootstrap";

/** Query parameter that carries the session token on WebSocket URLs, which cannot set request headers in browsers. */
export const TOKEN_QUERY_PARAMETER = "token";

export interface HealthResponse {
  status: "ok";
  version: string;
}

export interface BootstrapResponse {
  /** Logical server identity the client must expect during the pi-protocol handshake. */
  serverId: string;
}
