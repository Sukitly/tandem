import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PAIR_CODE_PATH, type PairingCode, PROOF_PATH, type ProofRequest, type ProofResponse } from "@tandem/contracts";
import { tokensMatch } from "./auth.ts";
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
  // Ask the listener to prove it holds this installation's key before sending that key anywhere: any program can
  // occupy the port, and the key must not reach one that is not ours.
  const nonce = randomBytes(32).toString("base64url");
  let answered: ProofResponse | undefined;
  try {
    const response = await fetch(new URL(PROOF_PATH, base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce } satisfies ProofRequest),
      signal: AbortSignal.timeout(1500),
    });
    if (response.ok) answered = (await response.json()) as ProofResponse;
  } catch {
    return undefined;
  }
  const expected = createHmac("sha256", identity.token).update(nonce).digest("hex");
  if (answered === undefined || answered.serverId !== identity.serverId || !tokensMatch(expected, answered.proof))
    return undefined;
  const issued = await fetch(new URL(PAIR_CODE_PATH, base), {
    method: "POST",
    headers: { authorization: `Bearer ${identity.token}` },
    signal: AbortSignal.timeout(3000),
  });
  if (issued.status === 404)
    throw new Error(
      "The server on this port runs another Tandem, or a version without pairing codes. Stop it, then start again.",
    );
  if (!issued.ok) throw new Error(`Cannot request a pairing link (status ${issued.status})`);
  return (await issued.json()) as PairingCode;
}

async function openBrowser(url: URL): Promise<void> {
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
