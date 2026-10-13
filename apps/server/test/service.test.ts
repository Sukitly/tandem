import { expect, test } from "vitest";
import {
  launchdPlist,
  type ServiceConfig,
  serviceFile,
  serviceFileText,
  servicePath,
  systemdUnit,
} from "../src/service-file.ts";
import {
  installRefusal,
  logHints,
  type ServiceTargets,
  serviceRecipe,
  serviceUpFailure,
  unloadRefusal,
} from "../src/service-policy.ts";

const config: ServiceConfig = {
  node: "/opt/node/bin/node",
  repository: "/repo",
  stateDir: "/state",
  logPath: "/state/tandem.log",
  path: "/opt/node/bin:/usr/bin",
};

test("a launchd agent runs the server without a terminal, and keeps it up without a shell", () => {
  const plist = launchdPlist(config);
  expect(plist).toContain("<string>/opt/node/bin/node</string>");
  expect(plist).toContain("<string>/repo/apps/server/src/main.ts</string>");
  expect(plist).toContain("<string>--no-open</string>");
  expect(plist).toContain("<key>WorkingDirectory</key>\n  <string>/repo</string>");
  expect(plist).toContain("<string>/state/tandem.log</string>");
  // Start at login, restart after a crash, and stay stopped after a clean exit.
  expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
  expect(plist).toContain("<key>SuccessfulExit</key>\n    <false/>");
});

test("a systemd user unit runs the same server, with the state directory the command line used", () => {
  const unit = systemdUnit(config);
  expect(unit).toContain('ExecStart="/opt/node/bin/node" "/repo/apps/server/src/main.ts" --no-open');
  expect(unit).toContain('Environment="PATH=/opt/node/bin:/usr/bin"');
  expect(unit).toContain('Environment="TANDEM_HOME=/state"');
  expect(unit).toContain("Restart=on-failure");
  expect(unit).toContain("WantedBy=default.target");
});

test("the service file is the one this platform reads", () => {
  expect(serviceFile("darwin", "/Users/me")).toBe("/Users/me/Library/LaunchAgents/com.tandem.server.plist");
  expect(serviceFile("linux", "/home/me")).toBe("/home/me/.config/systemd/user/tandem.service");
  expect(serviceFileText("darwin", config)).toBe(launchdPlist(config));
  expect(serviceFileText("linux", config)).toBe(systemdUnit(config));
});

test("the PATH a service gets keeps what exists and never a session's shim", () => {
  const usable = (entry: string): boolean => entry !== "/gone";
  expect(servicePath(["/a", "/gone", "/x/fnm_multishells/1/bin", "/b", "/a"], ["/node", "/a"], usable)).toBe(
    "/node:/a:/b",
  );
  expect(servicePath([], ["/node", "/node"], usable)).toBe("/node");
});

test("a path that needs escaping stays one value in the file", () => {
  expect(launchdPlist({ ...config, repository: "/re&po<x>" })).toContain("<string>/re&amp;po&lt;x&gt;</string>");
});

const targets: ServiceTargets = {
  domain: "gui/501",
  target: "gui/501/com.tandem.server",
  file: "/home/me/agent.plist",
};

test("a port held by a server that is not this service stops the install", () => {
  // The service would find that server, print its link, exit, and leave nothing running.
  expect(installRefusal({ portHeld: true, serviceRunning: false, answers: true })).toMatch(/already answers on port/);
  expect(installRefusal({ portHeld: true, serviceRunning: false, answers: false })).toMatch(/held by another program/);
  // Its own running server is not in the way: installing again updates it.
  expect(installRefusal({ portHeld: true, serviceRunning: true, answers: true })).toBeUndefined();
  expect(installRefusal({ portHeld: false, serviceRunning: false, answers: false })).toBeUndefined();
});

test("a service that is up is one that is running and answering", () => {
  expect(serviceUpFailure({ serviceRunning: true, answers: true })).toBeUndefined();
  expect(serviceUpFailure({ serviceRunning: false, answers: true })).toMatch(/another server there/);
  expect(serviceUpFailure({ serviceRunning: false, answers: false })).toMatch(/did not stay running/);
});

test("a service that did not stop stops the uninstall", () => {
  expect(unloadRefusal({ serviceRunning: false, serviceLoaded: false })).toBeUndefined();
  expect(unloadRefusal({ serviceRunning: true, serviceLoaded: false })).toMatch(/still there/);
  expect(unloadRefusal({ serviceRunning: false, serviceLoaded: true })).toMatch(/still there/);
});

test("Linux takes the file again and restarts, and only macOS reloads by hand", () => {
  const linux = serviceRecipe("linux", targets);
  expect(linux.load.at(-1)?.args).toEqual(["--user", "restart", "tandem"]);
  expect(linux.load.map((step) => step.args[1])).toEqual(["daemon-reload", "enable", "restart"]);
  // Removing the unit needs the manager to forget it afterwards.
  expect(linux.afterRemoval).toEqual([{ command: "systemctl", args: ["--user", "daemon-reload"] }]);
  const darwin = serviceRecipe("darwin", targets);
  expect(darwin.load.map((step) => step.args[0])).toEqual(["bootout", "bootstrap"]);
  // Both moving steps wait for the job to be gone: bootout has not finished when it returns.
  expect(darwin.load[0]?.settle).toBe(true);
  expect(darwin.unload[0]?.settle).toBe(true);
  expect(darwin.afterRemoval).toEqual([]);
});

test("the hints say where to look on each platform", () => {
  expect(logHints("darwin", "/state/tandem.log", targets).follow).toBe("tail -f /state/tandem.log");
  expect(logHints("darwin", "/state/tandem.log", targets).status).toBe("launchctl print gui/501/com.tandem.server");
  const linux = logHints("linux", "/state/tandem.log", { domain: "", target: "tandem", file: "/u.service" });
  expect(linux.follow).toBe("journalctl --user -u tandem -f");
  expect(linux.follow).not.toContain("/state/tandem.log");
});

test("a path that systemd would read as syntax stays one path", () => {
  // `%` begins a specifier, `$` begins a variable in ExecStart, and a quote or a backslash ends the value early.
  expect(systemdUnit({ ...config, repository: "/re %u" })).toContain('WorkingDirectory="/re %%u"');
  expect(systemdUnit({ ...config, repository: "/re %u" })).toContain(
    'ExecStart="/opt/node/bin/node" "/re %%u/apps/server/src/main.ts"',
  );
  expect(systemdUnit({ ...config, repository: "/re $HOME" })).toContain(
    'ExecStart="/opt/node/bin/node" "/re $$HOME/apps/server/src/main.ts"',
  );
  expect(systemdUnit({ ...config, repository: '/re"po\\x' })).toContain('WorkingDirectory="/re\\"po\\\\x"');
  expect(systemdUnit({ ...config, stateDir: "/state 100%" })).toContain('Environment="TANDEM_HOME=/state 100%%"');
  // Environment takes no `$`: a dollar sign there is a dollar sign, and doubling it would change the path.
  expect(systemdUnit({ ...config, stateDir: "/state $x" })).toContain('Environment="TANDEM_HOME=/state $x"');
});

test("the public origin the environment configured goes into the file", () => {
  const withUrl: ServiceConfig = { ...config, publicUrl: "https://tandem.example.com" };
  expect(launchdPlist(withUrl)).toContain(
    "<key>TANDEM_PUBLIC_URL</key>\n    <string>https://tandem.example.com</string>",
  );
  expect(systemdUnit(withUrl)).toContain('Environment="TANDEM_PUBLIC_URL=https://tandem.example.com"');
  expect(launchdPlist(config)).not.toContain("TANDEM_PUBLIC_URL");
  expect(systemdUnit(config)).not.toContain("TANDEM_PUBLIC_URL");
});
