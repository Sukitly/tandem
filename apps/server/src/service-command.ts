/**
 * `bun run service install|pair|restart|status|uninstall`: runs the server as a service, so that closing the terminal does
 * not end it. macOS gets a launchd agent, Linux a systemd user unit; an init system reads no shell configuration, so
 * every path here is computed, and every value that goes into the file is escaped for the syntax of that file.
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
import { printInstalledPairing, printServicePairing } from "./service-pair.ts";
import {
  type Invocation,
  installRefusal,
  logHints,
  type ServiceTargets,
  serviceRecipe,
  serviceUpFailure,
  unloadRefusal,
} from "./service-policy.ts";
import { defaultStateDirPath } from "./state-dir.ts";

/** Internal entry point; tests supply an isolated server address, not a public CLI option. */
export async function runService(
  args: readonly string[],
  address = new URL(`http://${DEFAULT_HOST}:${DEFAULT_PORT}`),
): Promise<number> {
  const repository = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
  const platform = process.platform;
  const base = address.href.replace(/\/$/, "");
  let exitCode = 0;

  /** The launchd domain and job, or the systemd unit, and the file the init system reads. */
  function targets(): ServiceTargets {
    const domain = `gui/${process.getuid?.() ?? 0}`;
    return {
      domain,
      target: platform === "darwin" ? `${domain}/${SERVICE_LABEL}` : SERVICE_UNIT,
      file: serviceFile(platform),
    };
  }

  /** Runs a command with its output shown, and fails on a non-zero exit. */
  function run(command: string, args: readonly string[]): void {
    const result = spawnSync(command, [...args], { cwd: repository, stdio: ["ignore", "inherit", "inherit"] });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? "a signal"}`);
  }

  /** Runs a command for its exit code and what it said. */
  function quiet(command: string, args: readonly string[]): { code: number; output: string } {
    const result = spawnSync(command, [...args], { cwd: repository, encoding: "utf8" });
    return { code: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  }

  /**
   * Whether the service's own process is running. Being registered says nothing: a macOS agent stopped with `SIGTERM`
   * stays loaded, and a server that is not ours can hold the port.
   */
  function running(): boolean {
    return platform === "darwin"
      ? /^\tpid = \d+$/m.test(quiet("launchctl", ["print", targets().target]).output)
      : quiet("systemctl", ["--user", "is-active", "--quiet", SERVICE_UNIT]).code === 0;
  }

  /** Whether the service is registered with the service manager at all. */
  function loaded(): boolean {
    return platform === "darwin"
      ? quiet("launchctl", ["print", targets().target]).code === 0
      : quiet("systemctl", ["--user", "is-enabled", "--quiet", SERVICE_UNIT]).code === 0;
  }

  function pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function apply(invocations: readonly Invocation[]): Promise<void> {
    for (const step of invocations) {
      let succeeded = false;
      for (let attempt = 0; ; attempt++) {
        const result = quiet(step.command, step.args);
        if (result.code === 0) {
          succeeded = true;
          break;
        }
        if (step.tolerant) break;
        if (attempt >= (step.retries ?? 0))
          throw new Error(`${step.command} ${step.args.join(" ")} failed: ${result.output.trim()}`);
        await pause(500);
      }
      // Only a step that worked has something to settle; a refused one is the verification's to report.
      if (succeeded && step.settle) await waitUntilGone();
    }
  }

  /** Bootout returns before the job is gone: the next bootstrap, or the verification, must not race with it. */
  async function waitUntilGone(): Promise<void> {
    const deadline = Date.now() + 10_000;
    while ((running() || loaded()) && Date.now() < deadline) await pause(100);
  }

  /** Everything a service file needs, computed from this process rather than typed by hand. */
  function serviceConfig(): ServiceConfig {
    const stateDir = defaultStateDirPath();
    const publicUrl = process.env.TANDEM_PUBLIC_URL;
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
      ...(publicUrl === undefined ? {} : { publicUrl }),
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

  async function install(options: { print: boolean }): Promise<void> {
    const config = serviceConfig();
    const file = targets().file;
    if (options.print) {
      process.stdout.write(serviceFileText(platform, config));
      return;
    }
    if (!existsSync(join(repository, "apps/web/dist/index.html"))) run("bun", ["run", "build"]);
    // A refused install changes nothing, so the port is settled before anything is created.
    const refusal = installRefusal({
      portHeld: await held(Number(address.port)),
      serviceRunning: running(),
      answers: await answers(),
    });
    if (refusal !== undefined) throw new Error(refusal);
    // The state directory holds the master key and the log. Creating it here, at 0700, keeps that the install's doing:
    // on macOS the service manager creates it when it opens the log, world-readable, if it is not already there.
    await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, serviceFileText(platform, config));
    console.log(`Wrote ${file}`);
    if (config.publicUrl !== undefined)
      console.log(`Kept TANDEM_PUBLIC_URL=${config.publicUrl} from this environment.`);
    await apply(serviceRecipe(platform, targets()).load);
    await expectUp(logHints(platform, config.logPath, targets()));
    if (!(await printInstalledPairing(new URL(base)))) exitCode = 1;
  }

  /** Rebuilds the web app and starts the server again, which is what new code needs. */
  async function restart(): Promise<void> {
    const config = serviceConfig();
    // The file is the service: it may be installed and stopped, which is still something to start again.
    if (!existsSync(targets().file))
      throw new Error("The service is not installed. Install it with `bun run service install`.");
    run("bun", ["run", "build"]);
    await apply(serviceRecipe(platform, targets()).restart);
    await expectUp(logHints(platform, config.logPath, targets()));
  }

  async function expectUp(hints: { follow: string; status: string }): Promise<void> {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const failure = serviceUpFailure({ serviceRunning: running(), answers: await answers() });
      if (failure === undefined) break;
      if (Date.now() >= deadline)
        throw new Error(`${failure}. Look at \`${hints.status}\` and follow it with \`${hints.follow}\``);
      await pause(500);
    }
    console.log(`Tandem answers on ${base}`);
    console.log("For a fresh pairing link: bun run service pair");
    console.log(`Follow it with: ${hints.follow}`);
    if (platform !== "darwin")
      console.log(`To keep it running while logged out: loginctl enable-linger ${process.env.USER ?? "$USER"}`);
  }

  async function uninstall(): Promise<void> {
    const service = targets();
    const hints = logHints(platform, serviceConfig().logPath, targets());
    // Whether the steps below work does not matter: what matters is whether the service is gone afterwards, and a
    // failure to stop it must not take the file away and leave the process behind.
    await apply(serviceRecipe(platform, service).unload);
    const refusal = unloadRefusal({ serviceRunning: running(), serviceLoaded: loaded() });
    if (refusal !== undefined)
      throw new Error(
        `${refusal}, so nothing was removed. Look at \`${hints.status}\` and follow it with \`${hints.follow}\``,
      );
    if (existsSync(service.file)) {
      await rm(service.file, { force: true });
      console.log(`Removed ${service.file}`);
    } else console.log(`No service file at ${service.file}`);
    await apply(serviceRecipe(platform, service).afterRemoval);
    console.log(
      `Data stays in ${serviceConfig().stateDir}; delete that directory to remove conversations and devices.`,
    );
  }

  async function status(): Promise<void> {
    if (platform === "darwin") {
      const result = quiet("launchctl", ["print", targets().target]);
      if (result.code !== 0)
        console.log(`${SERVICE_LABEL} is not registered. Install it with \`bun run service install\`.`);
      else
        for (const line of result.output.split("\n"))
          if (/^\t(state|pid|last exit code|last exit reason) =/.test(line)) console.log(line.trim());
    } else {
      process.stdout.write(quiet("systemctl", ["--user", "status", "--no-pager", SERVICE_UNIT]).output);
    }
    console.log(running() ? "The service is running" : "The service is not running");
    console.log((await answers()) ? `Tandem answers on ${base}` : `Nothing answers on ${base}`);
  }

  const [action = "", ...rest] = args;
  if (platform === "win32") throw new Error("A service is set up on macOS and Linux; on Windows, run `bun run start`.");
  else if (action === "install") await install({ print: rest.includes("--print") });
  else if (action === "pair") await printServicePairing(new URL(base));
  else if (action === "restart") await restart();
  else if (action === "uninstall") await uninstall();
  else if (action === "status") await status();
  else
    console.log(
      [
        "usage: bun run service <install|pair|restart|status|uninstall>",
        "",
        `  install [--print]   write ${targets().file} and load it; --print only shows the file`,
        "  pair                print a fresh pairing link without building or restarting",
        "  restart             build the web app and start the server again, after new code",
        "  status              what the service manager says, and whether the server answers",
        "  uninstall           unload the service and remove its file",
      ].join("\n"),
    );

  return exitCode;
}
