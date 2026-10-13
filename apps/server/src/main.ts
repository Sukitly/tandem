import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_HOST, DEFAULT_PORT } from "@tandem/contracts";
import { startApp } from "./app.ts";
import { configureModelHttp } from "./http-setup.ts";
import { pairingUrl, runningPair, showPairing } from "./launch.ts";
import { createFauxProvider, defaultProviders, demoResponse } from "./models.ts";
import { publicOrigin } from "./server.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string" },
    "public-url": { type: "string" },
    "no-open": { type: "boolean", default: false },
  },
});
const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be between 1 and 65535");
const webOrigin = process.env.TANDEM_WEB_ORIGIN;
const local = new URL(`http://${DEFAULT_HOST}:${port}`);
const requestedPublicUrl = values["public-url"] ?? process.env.TANDEM_PUBLIC_URL;
const publicUrl = requestedPublicUrl === undefined ? undefined : publicOrigin(requestedPublicUrl);
const existing = await runningPair(local);
if (existing !== undefined) {
  if (publicUrl !== undefined && publicUrl !== existing.publicUrl)
    throw new Error("The running server uses a different public-url. Stop it before changing the public origin.");
  await showPairing(pairingUrl(webOrigin ?? local, existing.code), !values["no-open"]);
} else {
  configureModelHttp();
  const faux = process.env.TANDEM_FAUX === "1";
  const server = await startApp({
    port,
    publicUrl,
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
      await server.stop();
      process.exit(0);
    });
  console.log(`Tandem listening on ${server.url}`);
  const pair = server.pair();
  await showPairing(pairingUrl(webOrigin ?? server.url, pair.code), !values["no-open"]);
  if (server.publicUrl !== undefined) console.log(`Remote pairing: ${pairingUrl(server.publicUrl, pair.code)}`);
}
