import { expect, test } from "vitest";
import {
  launchdPlist,
  type ServiceConfig,
  serviceFile,
  serviceFileText,
  servicePath,
  systemdUnit,
} from "../src/service-file.ts";

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
