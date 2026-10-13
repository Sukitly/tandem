import { pairingUrl, runningPair } from "./launch.ts";

/** Print a fresh link without opening a browser, building, or restarting the server. */
export async function printServicePairing(base: URL): Promise<void> {
  const pair = await runningPair(base);
  if (pair === undefined)
    throw new Error(
      "Cannot verify the running Tandem. Check `bun run service status` and use the service's TANDEM_HOME.",
    );
  console.log(`Open this link to pair your browser:\n${pairingUrl(pair.entry ?? base, pair.code).href}`);
  if (pair.publicUrl !== undefined) console.log(`Remote pairing: ${pairingUrl(pair.publicUrl, pair.code).href}`);
  console.log("This link expires in five minutes and can be used once.");
  console.log("For a new link: bun run service pair");
}

/** Installation succeeded even when requesting its pairing link fails. */
export async function printInstalledPairing(base: URL): Promise<void> {
  try {
    await printServicePairing(base);
  } catch (error) {
    console.error(`The service is running, but generating a pairing link failed: ${String(error)}`);
    console.error("Try again with `bun run service pair` using the same TANDEM_HOME.");
    process.exitCode = 1;
  }
}
