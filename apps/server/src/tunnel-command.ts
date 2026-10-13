/**
 * `bun run tunnel configure|status`: keeps the Cloudflare tunnel this machine publishes Tandem behind. The tunnel
 * itself runs as a child of the server, so one service covers both and `bun run service status` reports it.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_HOST, DEFAULT_PORT, HEALTH_PATH, type HealthResponse } from "@tandem/contracts";
import { serviceFile } from "./service-file.ts";
import { defaultStateDirPath } from "./state-dir.ts";
import { loadTunnelConfig, saveTunnelConfig, tunnelConfigPath } from "./tunnel-config.ts";
import { tunnelFileYamlPath } from "./tunnel-file.ts";
import { CLOUDFLARED, startTunnel } from "./tunnel-runner.ts";
import { createTunnelHere, setupTunnel } from "./tunnel-setup.ts";

export interface TunnelCommandOptions {
  /** The service file to reuse a running server from. A test points this at nothing, so no test reloads a service. */
  serviceFile?: string;
  /** How the service is reloaded. A test watches this instead of running the command line. */
  reload?: () => Promise<number>;
}

/** Internal entry point; tests supply an isolated state directory, not a public CLI option. */
export async function runTunnel(
  args: readonly string[],
  stateDir = defaultStateDirPath(),
  options: TunnelCommandOptions = {},
): Promise<void> {
  const [action = "", ...rest] = args;
  if (action === "create") return create(rest);
  if (action === "setup") return setup(rest, stateDir, options);
  if (action === "configure") return configure(rest, stateDir, options);
  if (action === "status") return status(stateDir, rest.includes("--verify"));
  console.log(
    [
      "usage: bun run tunnel <create|configure|setup|status>",
      "",
      "Two machines, two roles. Where account authority is acceptable — your own machine — create the tunnel and hand",
      "the token to the machine that runs it. On a machine you share, only ever do the second half.",
      "",
      "  create --public-url <https origin>      here: authorize this machine, create the tunnel, point the hostname",
      "         [--force]                        at it, and print the token the other machine runs it with",
      "  configure --public-url <https origin>   there: record the origin and the token of that tunnel",
      "            [--token-file <path|->]       the token, from a file or from standard input",
      "  setup --public-url <https origin>       one machine that is yours alone: create it, and run it here",
      "  status [--verify]                       what is configured, and what the running server reports",
      "",
      "The tunnel starts and stops with the server: `bun run service restart` starts one that is already configured.",
    ].join("\n"),
  );
}

/**
 * The owner side. It prints the token rather than writing it anywhere, because the machine that should hold it is
 * the one this command is not running on.
 */
async function create(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: { "public-url": { type: "string" }, force: { type: "boolean", default: false } },
  });
  const publicUrl = values["public-url"];
  if (publicUrl === undefined) throw new Error("create needs --public-url, the HTTPS origin the tunnel publishes");
  const result = await createTunnelHere({
    publicUrl,
    force: values.force,
    report: (line) => console.log(line),
  });
  console.log(`Tunnel ${result.tunnelId} is ready, and will publish ${publicUrl}.`);
  console.log("");
  console.log("On the machine that runs Tandem, paste this token:");
  console.log("");
  console.log(`  bun run tunnel configure --public-url ${publicUrl} --token-file -`);
  console.log("");
  console.log(result.token);
  console.log("");
  console.log("Then `bun run service restart` there. Do not run `tunnel setup` on that machine: it would need");
  console.log("authority over this account, which is the one thing it should not have.");
}

/** The path with no token and no dashboard: authorize once, then let cloudflared do the rest. */
async function setup(args: readonly string[], stateDir: string, options: TunnelCommandOptions): Promise<void> {
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
  await apply(options);
}

async function configure(args: readonly string[], stateDir: string, options: TunnelCommandOptions): Promise<void> {
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
  await apply(options);
}

/**
 * A running server reads this configuration once, when it starts, and the tunnel is its child. Writing the files is
 * therefore only half the work: the service is reloaded here, so that one command leaves the tunnel running. A
 * service that is not installed is someone else's to start, and starting one here would be a surprise.
 */
async function apply(options: TunnelCommandOptions): Promise<void> {
  const file = options.serviceFile ?? serviceFile(process.platform);
  if (!existsSync(file)) {
    console.log("No service is installed: start Tandem with `bun run start`, and the tunnel comes with it.");
    return;
  }
  console.log("Reloading the service so it picks this up; anything the agent is running stops.");
  const code = await (options.reload ?? reloadService)();
  if (code !== 0)
    console.log("The service did not reload. Run `bun run service install`, then `bun run tunnel status --verify`.");
  else console.log("Check it with `bun run tunnel status --verify`.");
}

/** Writes the service file from this environment and loads it again. */
function reloadService(): Promise<number> {
  const entry = fileURLToPath(new URL("./service.ts", import.meta.url));
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [entry, "install"], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
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
