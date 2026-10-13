import { homedir } from "node:os";
import { join } from "node:path";
import { defaultStateDirPath } from "./state-dir.ts";

/** What the service is called: the launchd label, and the systemd unit. */
export const SERVICE_LABEL = "com.tandem.server";
export const SERVICE_UNIT = "tandem";

/**
 * A version manager's directory for one shell session, such as `fnm_multishells`: it belongs to a shell that will be
 * gone by the next login, so it must never reach a service that starts at login.
 */
const SESSION_SHIM = /fnm_multishells/;

/** What a service file needs: absolute paths, since an init system reads no shell configuration. */
export interface ServiceConfig {
  readonly node: string;
  readonly repository: string;
  /** The state directory, so that the service reads the data the command line used. */
  readonly stateDir: string;
  /** Where everything the server prints goes. */
  readonly logPath: string;
  /** The `PATH` the server and everything it starts sees. */
  readonly path: string;
}

/**
 * The `PATH` a service runs with: what the installing shell had, minus what a service cannot use and what no longer
 * exists, with the Node directory first so that `node` works in the agent's terminals too.
 */
export function servicePath(
  entries: readonly string[],
  additions: readonly string[],
  usable: (entry: string) => boolean,
): string {
  const kept: string[] = [];
  for (const entry of [...additions, ...entries]) {
    if (entry === "" || SESSION_SHIM.test(entry) || kept.includes(entry) || !usable(entry)) continue;
    kept.push(entry);
  }
  return kept.join(":");
}

/** Where the service writes what the server prints. */
export function serviceLogPath(stateDir: string = defaultStateDirPath()): string {
  return join(stateDir, "tandem.log");
}

/** The file an init system reads, which differs by platform. */
export function serviceFile(platform: NodeJS.Platform, home: string = homedir()): string {
  return platform === "darwin"
    ? join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`)
    : join(home, ".config", "systemd", "user", `${SERVICE_UNIT}.service`);
}

/** The service file for this platform, as text: a launchd property list, or a systemd unit. */
export function serviceFileText(platform: NodeJS.Platform, config: ServiceConfig): string {
  return platform === "darwin" ? launchdPlist(config) : systemdUnit(config);
}

/** launchd expands no `~`, takes no relative path, and reads no shell configuration: every value here is absolute. */
export function launchdPlist(config: ServiceConfig): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(SERVICE_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(config.node)}</string>
    <string>${xml(entryPoint(config))}</string>
    <string>--no-open</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(config.repository)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(config.path)}</string>
    <key>TANDEM_HOME</key>
    <string>${xml(config.stateDir)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <!-- Restart after a crash, and stay stopped after a clean exit, which is what a SIGTERM stop gives. -->
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(config.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(config.logPath)}</string>
</dict>
</plist>
`;
}

/** A user unit, so that it runs with this account and reaches the files the server works on. */
export function systemdUnit(config: ServiceConfig): string {
  return `[Unit]
Description=Tandem, a local-first coding agent
After=network.target

[Service]
Type=simple
WorkingDirectory="${config.repository}"
ExecStart="${config.node}" "${entryPoint(config)}" --no-open
Environment="PATH=${config.path}"
Environment="TANDEM_HOME=${config.stateDir}"
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
}

function entryPoint(config: ServiceConfig): string {
  return `${config.repository}/apps/server/src/main.ts`;
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
