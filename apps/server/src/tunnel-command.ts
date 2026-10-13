/**
 * `bun run tunnel configure|status`: keeps the Cloudflare tunnel this machine publishes Tandem behind. The tunnel
 * itself runs as a child of the server, so one service covers both and `bun run service status` reports it.
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DEFAULT_HOST, DEFAULT_PORT, HEALTH_PATH, type HealthResponse } from "@tandem/contracts";
import { defaultStateDirPath } from "./state-dir.ts";
import { loadTunnelConfig, saveTunnelConfig, tunnelConfigPath } from "./tunnel-config.ts";
import { CLOUDFLARED } from "./tunnel-runner.ts";

/** Internal entry point; tests supply an isolated state directory, not a public CLI option. */
export async function runTunnel(args: readonly string[], stateDir = defaultStateDirPath()): Promise<void> {
  const [action = "", ...rest] = args;
  if (action === "configure") return configure(rest, stateDir);
  if (action === "status") return status(stateDir);
  console.log(
    [
      "usage: bun run tunnel <configure|status>",
      "",
      "  configure --public-url <https origin>   the origin the tunnel publishes, which becomes Tandem's public URL",
      "            [--token-file <path|->]       the tunnel token, from a file or from standard input",
      "  status                                  what is configured, and whether the tunnel is connected",
      "",
      "The tunnel starts and stops with the server: `bun run service restart` starts one that is already configured.",
    ].join("\n"),
  );
}

async function configure(args: readonly string[], stateDir: string): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: { "public-url": { type: "string" }, "token-file": { type: "string" } },
  });
  const publicUrl = values["public-url"];
  if (publicUrl === undefined) throw new Error("configure needs --public-url, the HTTPS origin the tunnel publishes");
  // The token arrives on standard input or in a file: an argument would be kept by `ps` and the shell history.
  const source = values["token-file"];
  const token = (source === undefined || source === "-" ? await readStdin() : await readFile(source, "utf8")).trim();
  if (token === "") throw new Error("No tunnel token was given");
  const path = await saveTunnelConfig({ publicUrl, token }, stateDir);
  console.log(`Wrote ${path}`);
  console.log(`Tandem's public origin is ${publicUrl} from now on.`);
  console.log("Start the tunnel with `bun run service restart`.");
}

async function status(stateDir: string): Promise<void> {
  const path = tunnelConfigPath(stateDir);
  const config = await loadTunnelConfig(stateDir);
  if (config === undefined) {
    console.log(`No tunnel: ${path} does not exist.`);
    console.log("Create one in the Cloudflare dashboard, then run `bun run tunnel configure`.");
    return;
  }
  console.log(`Public origin: ${config.publicUrl}`);
  console.log(`Token: ${config.token.length} characters, read from ${path}`);
  if (missing(CLOUDFLARED)) console.log(`${CLOUDFLARED} is not on PATH, so nothing can run the tunnel.`);
  const running = await health();
  if (running === undefined) console.log("No server is answering, so nothing is running the tunnel right now.");
  else if (running.tunnel === undefined) console.log("The server that answered runs no tunnel: start it again.");
  else console.log(`The running server reports the tunnel as ${running.tunnel}.`);
}

async function health(): Promise<HealthResponse | undefined> {
  try {
    const url = new URL(HEALTH_PATH, `http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok ? ((await response.json()) as HealthResponse) : undefined;
  } catch {
    return undefined;
  }
}

/** A token is pasted from the dashboard, so standard input is the way in that leaves no trace behind. */
async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function missing(program: string): boolean {
  return (
    (spawnSync(program, ["--version"], { stdio: "ignore" }).error as NodeJS.ErrnoException | undefined)?.code ===
    "ENOENT"
  );
}
