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

export interface HealthResponse {
  status: "ok";
  version: string;
}
