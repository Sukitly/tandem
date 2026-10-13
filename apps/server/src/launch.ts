import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BOOTSTRAP_PATH, type BootstrapResponse, PAIR_CODE_PATH, type PairingCode } from "@tandem/contracts";
import { defaultStateDirPath } from "./state-dir.ts";

export function pairingUrl(base: string | URL, code: string): URL {
  const url = new URL("/pair", base);
  url.hash = code;
  return url;
}

/** Only reuse a server that proves possession of this installation's master key and identity. */
export async function runningPair(base: URL): Promise<PairingCode | undefined> {
  let identity: { serverId: string; token: string };
  try {
    identity = JSON.parse(await readFile(join(defaultStateDirPath(), "server.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (typeof identity.serverId !== "string" || typeof identity.token !== "string")
    throw new Error("Invalid server identity");
  const headers = { authorization: `Bearer ${identity.token}` };
  let response: Response;
  try {
    response = await fetch(new URL(BOOTSTRAP_PATH, base), { headers, signal: AbortSignal.timeout(1500) });
  } catch {
    return undefined;
  }
  if (!response.ok || ((await response.json()) as BootstrapResponse).serverId !== identity.serverId) return undefined;
  const issued = await fetch(new URL(PAIR_CODE_PATH, base), {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(3000),
  });
  if (!issued.ok) throw new Error(`Cannot request a pairing link (status ${issued.status})`);
  return (await issued.json()) as PairingCode;
}

export async function openBrowser(url: URL): Promise<void> {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url.href]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url.href]]
        : ["xdg-open", [url.href]];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command as string, args as string[], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Browser opener exited with ${code}`))));
  });
}

export async function showPairing(url: URL, open: boolean): Promise<void> {
  console.log(`Open ${url.href}`);
  console.log("Pairing links expire in five minutes. Run the command again for a fresh link.");
  if (open) {
    try {
      await openBrowser(url);
    } catch (error) {
      console.error(`Could not open the browser. Use the printed link. ${String(error)}`);
    }
  }
}
