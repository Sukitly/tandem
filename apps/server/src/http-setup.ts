import { EventEmitter } from "node:events";
import * as undici from "undici";

/** How long a model response may stay silent before the request fails. */
const IDLE_TIMEOUT_MS = 300_000;
/** Node's 250 ms default can cut off valid connection attempts on high-latency routes. */
const AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 2_000;

/**
 * Configure outgoing HTTP for model providers, as pi's coding agent does (`core/http-dispatcher.ts`): honour
 * `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`, allow long silences inside streamed answers, and keep `fetch` on the same
 * undici as the dispatcher. Without it, some providers' streams break off.
 */
export function configureModelHttp(): void {
  const dispatcher = withErrorListener(
    new undici.EnvHttpProxyAgent({
      allowH2: false,
      proxyTunnel: true,
      bodyTimeout: IDLE_TIMEOUT_MS,
      headersTimeout: IDLE_TIMEOUT_MS,
      connect: { autoSelectFamilyAttemptTimeout: AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS },
      clientFactory: createClient,
      factory: createOriginDispatcher,
    }),
  );
  undici.setGlobalDispatcher(dispatcher);
  // Node's bundled fetch can read compressed responses through npm undici's dispatcher without decompressing them.
  undici.install?.();
}

// Undici can emit an internal "error" while ending a fetch body mid-stream. The body stream still rejects; the
// listener only keeps EventEmitter from treating the event as unhandled and crashing the process.
function withErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) EventEmitter.prototype.on.call(dispatcher, "error", () => {});
  return dispatcher;
}

function createClient(origin: string | URL, options: object): undici.Dispatcher {
  return withErrorListener(new undici.Client(origin, options as undici.Client.Options));
}

function createOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
  const poolOptions = options as undici.Pool.Options;
  if (poolOptions.connections === 1) return createClient(origin, poolOptions);
  return withErrorListener(new undici.Pool(origin, { ...poolOptions, factory: createClient }));
}
