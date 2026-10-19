import { expect, test } from "vitest";
import { launchdPlist, proxyEnvironment, type ServiceConfig, servicePath, systemdUnit } from "../src/service-file.ts";
import { installRefusal, type ServiceTargets, serviceUpFailure, unloadRefusal } from "../src/service-policy.ts";

const config: ServiceConfig = {
  node: "/opt/node/bin/node",
  repository: "/repo",
  stateDir: "/state",
  logPath: "/state/tandem.log",
  path: "/opt/node/bin:/usr/bin",
};

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

const _targets: ServiceTargets = {
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

test("the proxy environment is normalized to upper-case names, without empty values", () => {
  expect(proxyEnvironment({ HTTPS_PROXY: "http://127.0.0.1:1087", NO_PROXY: "" })).toEqual({
    HTTPS_PROXY: "http://127.0.0.1:1087",
  });
  expect(proxyEnvironment({ https_proxy: "http://127.0.0.1:1087" })).toEqual({
    HTTPS_PROXY: "http://127.0.0.1:1087",
  });
});
