/**
 * `bun run service install|uninstall|status`: runs the server as a service, so that closing the terminal does not end
 * it. macOS gets a launchd agent, Linux a systemd user unit; everything the init system needs is absolute, so this
 * computes the paths instead of asking someone to edit a template.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_HOST, DEFAULT_PORT, HEALTH_PATH } from "@tandem/contracts";
import {
  SERVICE_LABEL,
  SERVICE_UNIT,
  type ServiceConfig,
  serviceFile,
  serviceFileText,
  serviceLogPath,
  servicePath,
} from "./service-file.ts";
import { defaultStateDirPath } from "./state-dir.ts";

const repository = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const platform = process.platform;
const base = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

/** Runs a command with its output shown and fails on a non-zero exit, which is what loading a service must not do. */
function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, [...args], { cwd: repository, stdio: ["ignore", "inherit", "inherit"] });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? "a signal"}`);
}

/** Runs a command for a yes-or-no answer, discarding what it says. */
function quiet(command: string, args: readonly string[]): { code: number; output: string } {
  const result = spawnSync(command, [...args], { cwd: repository, encoding: "utf8" });
  return { code: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function target(): string {
  return platform === "darwin" ? `gui/${process.getuid?.() ?? 0}/${SERVICE_LABEL}` : SERVICE_UNIT;
}

/** Whether this service is loaded, which is what tells its own server apart from someone else's. */
function loaded(): boolean {
  return platform === "darwin"
    ? quiet("launchctl", ["print", target()]).code === 0
    : quiet("systemctl", ["--user", "is-active", "--quiet", SERVICE_UNIT]).code === 0;
}

/** Everything a service file needs, computed from this process rather than typed by hand. */
function config(): ServiceConfig {
  const stateDir = defaultStateDirPath();
  return {
    node: process.execPath,
    repository,
    stateDir,
    logPath: serviceLogPath(stateDir),
    path: servicePath(
      process.env.PATH?.split(":") ?? [],
      [dirname(process.execPath), join(homedir(), ".bun", "bin")],
      existsSync,
    ),
  };
}

async function answers(): Promise<boolean> {
  try {
    return (await fetch(`${base}${HEALTH_PATH}`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

/** Whether anything at all listens, which matters before a service tries to take the port. */
function held(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: DEFAULT_HOST, timeout: 500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function load(file: string): Promise<void> {
  if (platform === "darwin") {
    // Loading an already loaded agent fails, so let go of it first; there is nothing to let go of the first time.
    quiet("launchctl", ["bootout", target()]);
    // launchd answers a bootstrap with an I/O error while it is still letting go of the job it just stopped.
    const deadline = Date.now() + 10_000;
    while (loaded() && Date.now() < deadline) await pause(100);
    for (let attempt = 0; ; attempt++) {
      const result = quiet("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 0}`, file]);
      if (result.code === 0) return;
      if (attempt >= 4) throw new Error(`launchctl bootstrap failed: ${result.output.trim()}`);
      await pause(500);
    }
  }
  run("systemctl", ["--user", "daemon-reload"]);
  run("systemctl", ["--user", "enable", "--now", SERVICE_UNIT]);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unload(): void {
  if (platform === "darwin") quiet("launchctl", ["bootout", target()]);
  else {
    quiet("systemctl", ["--user", "disable", "--now", SERVICE_UNIT]);
    quiet("systemctl", ["--user", "daemon-reload"]);
  }
}

async function install(options: { print: boolean }): Promise<void> {
  const file = serviceFile(platform);
  const text = serviceFileText(platform, config());
  if (options.print) {
    process.stdout.write(text);
    return;
  }
  if (!existsSync(join(repository, "apps/web/dist/index.html"))) run("bun", ["run", "build"]);
  // Installing again updates a running service, so only a server that is not this service's is in the way.
  if ((await held(DEFAULT_PORT)) && !loaded())
    throw new Error(
      (await answers())
        ? `Tandem already answers on port ${DEFAULT_PORT}. Stop it first: the service would find it, print its link, and exit.`
        : `Port ${DEFAULT_PORT} is held by another program. Free it, then install.`,
    );
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  console.log(`Wrote ${file}`);
  await load(file);
  await expectAnswer();
}

/** Rebuilds the web app and starts the server again, which is what new code needs. */
async function restart(): Promise<void> {
  if (!loaded()) throw new Error("The service is not loaded. Install it with `bun run service install`.");
  run("bun", ["run", "build"]);
  if (platform === "darwin") run("launchctl", ["kickstart", "-k", target()]);
  else run("systemctl", ["--user", "restart", SERVICE_UNIT]);
  await expectAnswer();
}

async function expectAnswer(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await answers()) {
      console.log(`Tandem answers on ${base}`);
      console.log("Pair a browser with `bun run start`: it finds the running server and prints a fresh link.");
      console.log(`Output: tail -f ${serviceLogPath()}`);
      if (platform !== "darwin")
        console.log(`To keep it running while logged out: loginctl enable-linger ${process.env.USER ?? "$USER"}`);
      return;
    }
    await pause(500);
  }
  throw new Error(`The service is loaded but does not answer yet. Look at ${serviceLogPath()}`);
}

async function uninstall(): Promise<void> {
  unload();
  const file = serviceFile(platform);
  await rm(file, { force: true });
  console.log(`Removed ${file}`);
}

async function status(): Promise<void> {
  if (platform === "darwin") {
    const result = quiet("launchctl", ["print", target()]);
    if (result.code !== 0) console.log(`${SERVICE_LABEL} is not loaded. Install it with \`bun run service install\`.`);
    else
      for (const line of result.output.split("\n"))
        if (/^\t(state|pid|last exit code|last exit reason) =/.test(line)) console.log(line.trim());
  } else {
    process.stdout.write(quiet("systemctl", ["--user", "status", "--no-pager", SERVICE_UNIT]).output);
  }
  console.log((await answers()) ? `Tandem answers on ${base}` : `Nothing answers on ${base}`);
}

const [action = "", ...rest] = process.argv.slice(2);
if (platform === "win32") throw new Error("A service is set up on macOS and Linux; on Windows, run `bun run start`.");
else if (action === "install") await install({ print: rest.includes("--print") });
else if (action === "restart") await restart();
else if (action === "uninstall") await uninstall();
else if (action === "status") await status();
else
  console.log(
    [
      "usage: bun run service <install|restart|status|uninstall>",
      "",
      `  install [--print]   write ${serviceFile(platform)} and load it; --print only shows the file`,
      "  restart             build the web app and start the server again, after new code",
      "  status              what the service manager says, and whether the server answers",
      "  uninstall           unload the service and remove its file",
    ].join("\n"),
  );
