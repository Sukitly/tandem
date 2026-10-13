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
import { tunnelFileYamlPath } from "./tunnel-file.ts";
import { CLOUDFLARED, startTunnel } from "./tunnel-runner.ts";
import { setupTunnel } from "./tunnel-setup.ts";

/** Internal entry point; tests supply an isolated state directory, not a public CLI option. */
export async function runTunnel(args: readonly string[], stateDir = defaultStateDirPath()): Promise<void> {
  const [action = "", ...rest] = args;
  if (action === "setup") return setup(rest, stateDir);
  if (action === "configure") return configure(rest, stateDir);
  if (action === "status") return status(stateDir, rest.includes("--verify"));
  console.log(
    [
      "usage: bun run tunnel <setup|configure|status>",
      "",
      "  setup --public-url <https origin>       authorize this machine, create the tunnel, point the hostname at it,",
      "        [--force]                         and write the configuration. --force replaces an existing DNS record",
      "  configure --public-url <https origin>   a tunnel a dashboard describes: record its origin and its token",
      "            [--token-file <path|->]       the token, from a file or from standard input",
      "  status [--verify]                       what is configured, and what the running server reports",
      "",
      "The tunnel starts and stops with the server: `bun run service restart` starts one that is already configured.",
    ].join("\n"),
  );
}

/** The path with no token and no dashboard: authorize once, then let cloudflared do the rest. */
async function setup(args: readonly string[], stateDir: string): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: { "public-url": { type: "string" }, force: { type: "boolean", default: false } },
  });
  const publicUrl = values["public-url"];
  if (publicUrl === undefined) throw new Error("setup needs --public-url, the HTTPS origin the tunnel publishes");
  const result = await setupTunnel({
    publicUrl,
    stateDir,
    force: values.force,
    report: (line) => console.log(line),
  });
  console.log(`Tunnel ${result.tunnelId} is ready.`);
  console.log("Start it with `bun run service restart`, then check it with `bun run tunnel status --verify`.");
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

async function status(stateDir: string, verify: boolean): Promise<void> {
  const path = tunnelConfigPath(stateDir);
  const config = await loadTunnelConfig(stateDir);
  if (config === undefined) {
    console.log(`No tunnel: ${path} does not exist.`);
    console.log("Run `bun run tunnel setup --public-url https://<hostname>` to create one.");
    return;
  }
  console.log(`Public origin: ${config.publicUrl}`);
  console.log(
    config.token === undefined
      ? `Run from ${tunnelFileYamlPath(stateDir)}, which this machine manages itself.`
      : `Token: ${config.token.length} characters, read from ${path}`,
  );
  if (missing(CLOUDFLARED)) console.log(`${CLOUDFLARED} is not on PATH, so nothing can run the tunnel.`);
  if (verify) await verified(config, stateDir);
  const running = await health();
  if (running === undefined) console.log("No server is answering, so nothing is running the tunnel right now.");
  else if (running.tunnel === undefined) console.log("The server that answered runs no tunnel: start it again.");
  else console.log(`The running server reports the tunnel as ${running.tunnel}.`);
}

/** Runs the tunnel here, briefly, so that this command answers "does it work" without a restart. */
async function verified(config: { publicUrl: string; token?: string }, stateDir: string): Promise<void> {
  const lines: string[] = [];
  const probe = startTunnel(config, { onLog: (line) => lines.push(line), stateDir });
  try {
    for (let waited = 0; waited < 20_000 && probe.state() === "starting"; waited += 250)
      await new Promise((resolve) => setTimeout(resolve, 250));
    const state = probe.state();
    console.log(state === "connected" ? "The tunnel connected." : `The tunnel did not connect: ${state}.`);
    if (state !== "connected") for (const line of lines.slice(-5)) console.log(line);
  } finally {
    await probe.stop();
  }
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
