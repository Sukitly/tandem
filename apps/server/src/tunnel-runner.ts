import { type ChildProcessByStdio, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { Readable } from "node:stream";
import type { TunnelState } from "@tandem/contracts";
import type { TunnelConfig } from "./tunnel-config.ts";
import { tunnelFileYamlPath } from "./tunnel-file.ts";

/** The command the tunnel runs, so that a test can stand in for it. */
export const CLOUDFLARED = "cloudflared";

/** cloudflared says this once the edge has accepted the connector; nothing else in its output means the same. */
const REGISTERED = /Registered tunnel connection/;

const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;

type TunnelChild = ChildProcessByStdio<null, Readable, Readable>;

export interface TunnelRunner {
  state(): TunnelState;
  stop(): Promise<void>;
}

export interface TunnelOptions {
  /** Every line cloudflared prints, so that the server's own log holds the reason for a failure. */
  onLog: (line: string) => void;
  /** The program to run, for tests that stand in for it. */
  executable?: string;
  /** Where the tunnel's own configuration is looked for: the state directory. */
  stateDir?: string;
}

/** How to run the tunnel: what it is told, and what it is given that is not an argument. */
export interface TunnelInvocation {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * A tunnel this machine manages itself is described by a configuration file beside the state, which carries the
 * hostname and the ingress rule. One a dashboard describes is run from its connector token instead. The file wins,
 * because it is the one `bun run tunnel setup` writes.
 */
export function tunnelInvocation(config: TunnelConfig, stateDir?: string): TunnelInvocation {
  const file = tunnelFileYamlPath(stateDir);
  if (existsSync(file)) return { args: ["tunnel", "--config", file, "--no-autoupdate", "run"], env: {} };
  if (config.token !== undefined)
    return { args: ["tunnel", "--no-autoupdate", "run"], env: { TUNNEL_TOKEN: config.token } };
  throw new Error(`No tunnel to run: ${file} is missing and no token was configured. Run \`bun run tunnel setup\`.`);
}

/**
 * Runs the tunnel as a child of the server, so that one service covers both and the tunnel starts wherever the server
 * does. A tunnel that dies on its own is started again, backing off, until it registers a connection.
 */
export function startTunnel(config: TunnelConfig, options: TunnelOptions): TunnelRunner {
  const executable = options.executable ?? CLOUDFLARED;
  const invocation = tunnelInvocation(config, options.stateDir);
  let state: TunnelState = "starting";
  let child: TunnelChild | undefined;
  let retry: NodeJS.Timeout | undefined;
  let attempts = 0;
  let stopping = false;

  function launch(): void {
    const running = spawn(executable, [...invocation.args], {
      env: {
        ...process.env,
        ...invocation.env,
        // The origin hop goes to this machine; a proxy in the environment must never carry it.
        NO_PROXY: merged("NO_PROXY"),
        no_proxy: merged("no_proxy"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    state = "starting";
    child = running;
    for (const stream of [running.stdout, running.stderr]) {
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        const lines = (pending + chunk).split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) accept(line);
      });
      stream.on("end", () => accept(pending));
    }
    running.on("error", (error: NodeJS.ErrnoException) => {
      child = undefined;
      if (stopping) return;
      if (error.code === "ENOENT") {
        state = "unavailable";
        options.onLog(`${executable} is not installed. Install it, then start Tandem again.`);
        return;
      }
      failed(`cloudflared could not start: ${error.message}`);
    });
    running.on("exit", (code, signal) => {
      child = undefined;
      if (stopping) return;
      failed(`cloudflared exited with ${code ?? signal ?? "no status"}`);
    });
  }

  function accept(line: string): void {
    if (line === "") return;
    options.onLog(line);
    if (REGISTERED.test(line)) {
      attempts = 0;
      state = "connected";
    }
  }

  function failed(reason: string): void {
    state = "failed";
    const delay = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** attempts);
    attempts += 1;
    options.onLog(`${reason}. Trying again in ${Math.round(delay / 1000)}s.`);
    retry = setTimeout(launch, delay);
    retry.unref();
  }

  /** A proxy in the environment must not carry the hop that stays on this machine. */
  function merged(name: string): string {
    const existing = process.env[name];
    const local = "127.0.0.1,localhost";
    return existing === undefined || existing === "" ? local : `${existing},${local}`;
  }

  async function stop(): Promise<void> {
    stopping = true;
    if (retry !== undefined) clearTimeout(retry);
    retry = undefined;
    const running = child;
    child = undefined;
    if (running === undefined) return;
    const ended = new Promise<void>((resolve) => running.once("exit", () => resolve()));
    running.kill("SIGTERM");
    const killed = setTimeout(() => running.kill("SIGKILL"), 5_000);
    killed.unref();
    await ended;
    clearTimeout(killed);
  }

  launch();
  return { state: () => state, stop };
}
