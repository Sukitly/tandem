import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_HOST, DEV_PORT, HEALTH_PATH } from "@tandem/contracts";
import { type DevChild, runChild, terminate } from "./dev-children.ts";
import { pairingUrl, runningPair, showPairing } from "./launch.ts";

const { values } = parseArgs({ options: { "no-open": { type: "boolean", default: false } } });
const root = fileURLToPath(new URL("../../../", import.meta.url));
const serverUrl = new URL(`http://${DEFAULT_HOST}:${DEV_PORT}`);
const webUrl = new URL(`http://${DEFAULT_HOST}:5173`);
const children: DevChild[] = [];
let stopping = false;
async function stop(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  await terminate(children, console.error);
  process.exit(code);
}
function start(label: string, command: string, args: string[]): void {
  children.push(
    runChild(label, command, args, {
      cwd: root,
      env: { ...process.env, TANDEM_WEB_ORIGIN: webUrl.origin },
      onLine: (line) => console.log(`[${label}] ${line}`),
      onError: (error) => {
        console.error(error);
        void stop(1);
      },
      onExit: (code) => {
        if (!stopping) void stop(code ?? 1);
      },
    }),
  );
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void stop(0);
  });
const requireWeb = createRequire(new URL("../../web/package.json", import.meta.url));
const viteEntry = join(dirname(requireWeb.resolve("vite/package.json")), "bin/vite.js");
if ((await runningPair(serverUrl)) !== undefined)
  throw new Error("Tandem is already running. Stop it before development, or use bun run start to open it.");
start("server", process.execPath, ["--watch", "apps/server/src/main.ts", "--port", String(DEV_PORT), "--no-open"]);
start("web", process.execPath, [viteEntry, "--config", "apps/web/vite.config.ts", "apps/web"]);
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
