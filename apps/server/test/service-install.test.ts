import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { startServer, type TandemServer } from "../src/server.ts";

const servers: TandemServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
});

/** Real authentication on a random port; only the service manager is a stand-in. */
async function bench() {
  const root = await mkdtemp(join(tmpdir(), "tandem-service-"));
  const home = join(root, "home");
  const state = join(root, "state");
  const bin = join(root, "bin");
  const record = join(root, "commands");
  const marker = join(root, "loaded");
  await mkdir(home);
  await mkdir(bin);
  const server = await startServer({ port: 0 });
  servers.push(server);
  // The manager reports the already-running test server as its job. Installation
  // still executes unload/load and verifies it before requesting a real code.
  await writeFile(marker, "running");
  const script = `#!/bin/sh\necho "$*" >> "$RECORD"\ncase "$1" in\n print) [ -f "$MARKER" ] || exit 3; printf '\\tpid = 123\\n' ;;\n bootout) [ -z "$REFUSE_STOP" ] || exit 5; printf stopped > "$MARKER" ;;\n bootstrap) printf running > "$MARKER" ;;\n --user) exit 0 ;;\nesac\n`;
  // A stopped marker must make launchctl print report a missing job.
  const manager = script.replace('[ -f "$MARKER" ]', '[ "$(cat "$MARKER" 2>/dev/null)" = running ]');
  for (const name of ["launchctl", "systemctl", "bun"]) {
    const path = join(bin, name);
    await writeFile(path, name === "bun" ? '#!/bin/sh\necho build >> "$RECORD"\nexit 99\n' : manager);
    await chmod(path, 0o755);
  }
  async function identity() {
    await mkdir(state, { recursive: true, mode: 0o700 });
    await writeFile(join(state, "server.json"), JSON.stringify({ serverId: server.serverId, token: server.token }));
  }
  async function command(args: string[], extra: Record<string, string> = {}) {
    const entry = new URL("../src/service-command.ts", import.meta.url).href;
    const source = `const { runService } = await import(${JSON.stringify(entry)}); process.exitCode = await runService(${JSON.stringify(args)}, new URL(${JSON.stringify(server.url.href)}));`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      env: {
        ...process.env,
        HOME: home,
        TANDEM_HOME: state,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        RECORD: record,
        MARKER: marker,
        ...extra,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    return { code, output };
  }
  const file =
    process.platform === "darwin"
      ? join(home, "Library/LaunchAgents/com.tandem.server.plist")
      : join(home, ".config/systemd/user/tandem.service");
  return { server, state, file, record, marker, identity, command };
}

async function redeem(output: string, server: TandemServer) {
  const link = output.match(/http:\/\/127\.0\.0\.1:\d+\/pair#[a-f0-9]+/)?.[0];
  expect(link).toBeDefined();
  if (link === undefined) throw new Error("No pairing link in command output");
  const response = await fetch(new URL("/auth/pair", server.url), {
    method: "POST",
    headers: { "content-type": "application/json", origin: server.url.origin },
    body: JSON.stringify({ code: new URL(link).hash.slice(1) }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
}

test("install prints a redeemable link and exits successfully", async () => {
  const b = await bench();
  await b.identity();
  const result = await b.command(["install"]);
  expect(result.code).toBe(0);
  await redeem(result.output, b.server);
  expect((await stat(b.file)).isFile()).toBe(true);
  const calls = await readFile(b.record, "utf8");
  expect(calls).not.toContain("build");
  if (process.platform === "darwin") expect(calls.indexOf("bootout")).toBeLessThan(calls.indexOf("bootstrap"));
});

test("pair uses real authentication without building or calling the service manager", async () => {
  const b = await bench();
  await b.identity();
  const result = await b.command(["pair"]);
  expect(result.code).toBe(0);
  await redeem(result.output, b.server);
  expect(await readFile(b.record, "utf8").catch(() => "")).toBe("");
});

test("missing identity reports pairing failure but preserves the installed service", async () => {
  const b = await bench();
  const result = await b.command(["install"]);
  expect(result.code).toBe(1);
  expect(result.output).toContain("The service is running, but generating a pairing link failed");
  expect((await stat(b.state)).mode & 0o777).toBe(0o700);
  expect((await stat(b.file)).isFile()).toBe(true);
  expect((await fetch(new URL("/health", b.server.url))).ok).toBe(true);
});

test.skipIf(process.platform !== "darwin")("refuses a foreign listener without writing a service file", async () => {
  const b = await bench();
  await writeFile(b.marker, "stopped");
  const result = await b.command(["install"]);
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("already answers on port");
  expect(await stat(b.file).catch(() => undefined)).toBeUndefined();
  expect(await stat(b.state).catch(() => undefined)).toBeUndefined();
});

test.skipIf(process.platform !== "darwin")("keeps the file when unloading is refused", async () => {
  const b = await bench();
  await b.command(["install"]);
  const refused = await b.command(["uninstall"], { REFUSE_STOP: "1" });
  expect(refused.code).not.toBe(0);
  expect((await stat(b.file)).isFile()).toBe(true);
  const removed = await b.command(["uninstall"]);
  expect(removed.code).toBe(0);
  expect(await stat(b.file).catch(() => undefined)).toBeUndefined();
});
