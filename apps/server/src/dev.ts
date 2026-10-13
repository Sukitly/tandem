import { type ChildProcess, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_HOST, DEFAULT_PORT, HEALTH_PATH } from "@tandem/contracts";
import { pairingUrl, runningPair, showPairing } from "./launch.ts";

const { values } = parseArgs({ options: { "no-open": { type: "boolean", default: false } } });
const root = fileURLToPath(new URL("../../../", import.meta.url));
const serverUrl = new URL(`http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
const webUrl = new URL(`http://${DEFAULT_HOST}:5173`);
const children: ChildProcess[] = [];
let stopping = false;
async function stop(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.pid === undefined) continue;
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  await Promise.all(
    children.map((child) =>
      child.exitCode !== null ? Promise.resolve() : new Promise<void>((resolve) => child.once("exit", () => resolve())),
    ),
  );
  process.exit(code);
}
function run(label: string, command: string, args: string[]): void {
  const child = spawn(command, args, {
    cwd: root,
    detached: process.platform !== "win32",
    env: { ...process.env, TANDEM_WEB_ORIGIN: webUrl.origin },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr])
    if (stream !== null) {
      const lines = createInterface({ input: stream });
      lines.on("line", (line) => console.log(`[${label}] ${line}`));
    }
  child.once("error", (error) => {
    console.error(error);
    void stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping) void stop(code ?? 1);
  });
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void stop(0);
  });
const requireWeb = createRequire(new URL("../../web/package.json", import.meta.url));
const viteEntry = join(dirname(requireWeb.resolve("vite/package.json")), "bin/vite.js");
if ((await runningPair(serverUrl)) !== undefined)
  throw new Error("Tandem is already running. Stop it before development, or use bun run start to open it.");
run("server", process.execPath, ["--watch", "apps/server/src/main.ts", "--no-open"]);
run("web", process.execPath, [viteEntry, "--config", "apps/web/vite.config.ts", "apps/web"]);
try {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (Date.now() >= deadline) throw new Error("Development servers did not become ready within 60 seconds");
    try {
      const responses = await Promise.all([
        fetch(new URL(HEALTH_PATH, serverUrl), { signal: AbortSignal.timeout(1000) }),
        fetch(webUrl, { signal: AbortSignal.timeout(1000) }),
      ]);
      if (responses.every((response) => response.ok)) break;
    } catch {
      /* Still starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const pair = await runningPair(serverUrl);
  if (pair === undefined) throw new Error("Could not obtain a development pairing link");
  await showPairing(pairingUrl(webUrl, pair.code), !values["no-open"]);
} catch (error) {
  console.error(error);
  await stop(1);
}
