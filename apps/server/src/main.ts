import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_HOST, DEFAULT_PORT } from "@tandem/contracts";
import { startApp } from "./app.ts";
import { configureModelHttp } from "./http-setup.ts";
import { pairingUrl, runningPair, showPairing } from "./launch.ts";
import { createFauxProvider, defaultProviders, demoResponse } from "./models.ts";
import { publicOrigin } from "./server.ts";
import { defaultStateDirPath } from "./state-dir.ts";
import { loadTunnelConfig } from "./tunnel-config.ts";
import { TunnelControl } from "./tunnel-control.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string" },
    "public-url": { type: "string" },
    "no-open": { type: "boolean", default: false },
  },
});
const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be between 1 and 65535");
const stateDir = defaultStateDirPath();
const webOrigin = process.env.TANDEM_WEB_ORIGIN;
const local = new URL(`http://${DEFAULT_HOST}:${port}`);
// The tunnel publishes an origin, which is this server's public origin: one answer, however it was supplied.
const control = new TunnelControl({ stateDir, onLog: (line) => console.log(line) });
const configured = await loadTunnelConfig(stateDir);
const requestedPublicUrl = values["public-url"] ?? process.env.TANDEM_PUBLIC_URL ?? configured?.publicUrl;
const publicUrl = requestedPublicUrl === undefined ? undefined : publicOrigin(requestedPublicUrl);
const existing = await runningPair(local);
if (existing !== undefined) {
  if (publicUrl !== undefined && publicUrl !== existing.publicUrl)
    throw new Error("The running server uses a different public-url. Stop it before changing the public origin.");
  // A running server reports where its page is served: reusing a development server must open the Vite page, not one
  // this server does not serve.
  await showPairing(pairingUrl(existing.entry ?? webOrigin ?? local, existing.code), !values["no-open"]);
  if (existing.publicUrl !== undefined) console.log(`Remote pairing: ${pairingUrl(existing.publicUrl, existing.code)}`);
} else {
  configureModelHttp();
  const faux = process.env.TANDEM_FAUX === "1";
  const server = await startApp({
    port,
    publicUrl,
    tunnel: control,
    tunnelState: () => control.tunnelState(),
    ...(webOrigin === undefined ? {} : { webEntry: webOrigin }),
    ...(webOrigin === undefined
      ? { webRoot: fileURLToPath(new URL("../../web/dist", import.meta.url)) }
      : { allowedOrigins: [webOrigin] }),
    providers: [
      ...defaultProviders(),
      ...(faux ? [createFauxProvider({ tokensPerSecond: 40, respond: demoResponse })] : []),
    ],
    onError: (error) => console.error(error),
  }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE")
      throw new Error(`Port ${port} is occupied. Choose another with --port.`, { cause: error });
    throw error;
  });
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      await control.stop();
      await server.stop();
      process.exit(0);
    });
  // A development server does not serve the page, so a tunnel to it would publish nothing.
  if (configured !== undefined && webOrigin === undefined) {
    await control.resume();
    console.log(`Tunnel: publishing ${configured.publicUrl}`);
  } else if (configured !== undefined) console.log("Tunnel: not started while a development server serves the page.");
  console.log(`Tandem listening on ${server.url}`);
  const pair = server.pair();
  await showPairing(pairingUrl(webOrigin ?? server.url, pair.code), !values["no-open"]);
  if (server.publicUrl !== undefined) console.log(`Remote pairing: ${pairingUrl(server.publicUrl, pair.code)}`);
}
