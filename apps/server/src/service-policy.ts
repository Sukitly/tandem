/**
 * What the service command decides, apart from running anything: what to refuse, which commands each platform runs,
 * and what to say when the server did not come up. Kept here so that the decisions can be tested without a service
 * manager, and read without the code that spawns things.
 */
import { DEFAULT_PORT } from "@tandem/contracts";
import { SERVICE_UNIT } from "./service-file.ts";

/** One command to run, with what makes it different from the others. */
export interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
  /** After running: wait until the service is gone. Bootout is not finished when it returns, and bootstrapping or
   * verifying while it lets go is an I/O error, or a false report that it is still there. */
  readonly settle?: boolean;
  /** Attempts after the first; a start that arrives while the old process lets go needs them. */
  readonly retries?: number;
  /** Its failure is not the answer: the state afterwards is, which the caller verifies. */
  readonly tolerant?: boolean;
}

export interface ServiceRecipe {
  /** Installing and updating both end here: the file on disk must be what the running service uses. */
  readonly load: readonly Invocation[];
  readonly unload: readonly Invocation[];
  readonly restart: readonly Invocation[];
  /** After the file is removed, where the service manager keeps a copy of it. */
  readonly afterRemoval: readonly Invocation[];
}

export interface ServiceTargets {
  /** The launchd domain, such as `gui/501`. */
  readonly domain: string;
  /** The launchd job, or the systemd unit. */
  readonly target: string;
  /** The file the init system reads. */
  readonly file: string;
}

/** What a platform runs. macOS reloads by letting go of the job and taking the file again; systemd restarts explicitly. */
export function serviceRecipe(platform: NodeJS.Platform, targets: ServiceTargets): ServiceRecipe {
  if (platform === "darwin")
    return {
      load: [
        { command: "launchctl", args: ["bootout", targets.target], tolerant: true, settle: true },
        { command: "launchctl", args: ["bootstrap", targets.domain, targets.file], retries: 5 },
      ],
      unload: [{ command: "launchctl", args: ["bootout", targets.target], tolerant: true, settle: true }],
      restart: [{ command: "launchctl", args: ["kickstart", "-k", targets.target] }],
      afterRemoval: [],
    };
  return {
    load: [
      // `enable --now` starts a unit that is not running and leaves a running one alone, so the file that was just
      // written would not reach the process: restart explicitly.
      { command: "systemctl", args: ["--user", "daemon-reload"] },
      { command: "systemctl", args: ["--user", "enable", SERVICE_UNIT] },
      { command: "systemctl", args: ["--user", "restart", SERVICE_UNIT] },
    ],
    unload: [{ command: "systemctl", args: ["--user", "disable", "--now", SERVICE_UNIT], tolerant: true }],
    restart: [{ command: "systemctl", args: ["--user", "restart", SERVICE_UNIT] }],
    afterRemoval: [{ command: "systemctl", args: ["--user", "daemon-reload"] }],
  };
}

/**
 * Why installing must stop, or nothing to go ahead. A server that is not this service's is not merely in the way: the
 * service would find it, print its pairing link, exit, and leave nothing running.
 */
export function installRefusal(state: {
  readonly portHeld: boolean;
  readonly serviceRunning: boolean;
  readonly answers: boolean;
}): string | undefined {
  if (!state.portHeld || state.serviceRunning) return undefined;
  return state.answers
    ? `Tandem already answers on port ${DEFAULT_PORT}. Stop it first: the service would find it, print its link, and exit with nothing running.`
    : `Port ${DEFAULT_PORT} is held by another program. Free it, then install.`;
}

/** Why the service is not up after loading it, or nothing when it is. */
export function serviceUpFailure(state: {
  readonly serviceRunning: boolean;
  readonly answers: boolean;
}): string | undefined {
  if (state.serviceRunning && state.answers) return undefined;
  if (!state.serviceRunning && state.answers)
    return "the port answers but the service is not running: it started, found another server there, and exited";
  if (state.serviceRunning) return "the service is running but does not answer yet";
  return "the service did not stay running";
}

/** Why the service could not be taken down, or nothing when it is gone. Nothing may be removed while this speaks. */
export function unloadRefusal(state: {
  readonly serviceRunning: boolean;
  readonly serviceLoaded: boolean;
}): string | undefined {
  if (!state.serviceRunning && !state.serviceLoaded) return undefined;
  return `the service is still there (running: ${state.serviceRunning}, registered: ${state.serviceLoaded})`;
}

/** Where to look when the server says nothing, which is a file on macOS and the journal on Linux. */
export function logHints(
  platform: NodeJS.Platform,
  logPath: string,
  targets: ServiceTargets,
): {
  readonly follow: string;
  readonly status: string;
} {
  return platform === "darwin"
    ? { follow: `tail -f ${logPath}`, status: `launchctl print ${targets.target}` }
    : { follow: `journalctl --user -u ${SERVICE_UNIT} -f`, status: `systemctl --user status ${SERVICE_UNIT}` };
}
