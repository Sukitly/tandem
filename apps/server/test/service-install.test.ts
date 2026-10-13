import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_HOST, DEFAULT_PORT } from "@tandem/contracts";
import { afterEach, describe, expect, test } from "vitest";

/** The command under test, run the way the repository runs it: Node, with type stripping, from the repository. */
const repository = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const command = join(repository, "apps/server/src/service.ts");

/** Whether the port the command uses is free; otherwise the suite would test against whatever holds it. */
async function portFree(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(DEFAULT_PORT, DEFAULT_HOST, () => probe.close(() => resolve(true)));
  });
}

interface Bench {
  /** The temporary directory this bench lives in. */
  readonly root: string;
  /** What the command computes the state directory from. */
  readonly state: string;
  /** Where the service file goes, from the bench's home. */
  readonly file: string;
  /** Every call to the stand-in launchd, one per line. */
  readonly record: string;
  readonly env: NodeJS.ProcessEnv;
}

const benches: string[] = [];
const spare: ReturnType<typeof spawn>[] = [];
afterEach(async () => {
  for (const child of spare.splice(0)) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  for (const root of benches.splice(0)) {
    // The stand-in launchd starts a stand-in server; take it down before the directory goes.
    const written = await readFile(join(root, "pid"), "utf8").catch(() => "");
    if (written.trim() !== "") {
      try {
        process.kill(Number(written.trim()), "SIGTERM");
      } catch {
        /* Already gone. */
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * A stand-in launchd, and the directory layout the command computes its paths from. It answers what the command asks
 * of a service manager: a job that was bootstrapped has a pid and is loaded, one that was booted out is gone, and a
 * refusal to boot out can be asked for. What it "runs" is a server on the command's port that answers `/health`, so
 * a successful install can be observed without a real agent behind it.
 */
async function bench(): Promise<Bench> {
  const root = await mkdtemp(join(tmpdir(), "tandem-service-"));
  benches.push(root);
  const home = join(root, "home");
  const bin = join(root, "bin");
  const state = join(root, "state");
  const record = join(root, "launchctl.log");
  const marker = join(root, "loaded");
  const pid = join(root, "pid");
  await mkdir(bin, { recursive: true });
  await mkdir(home, { recursive: true });
  const server = `require("node:http").createServer((request, response) => response.end("{}")).listen(${DEFAULT_PORT}, "${DEFAULT_HOST}")`;
  await writeFile(
    join(bin, "launchctl"),
    `#!/bin/sh
echo "$*" >> ${sh(record)}
case "$1" in
  print)
    if [ -f ${sh(marker)} ]; then printf '\\tpid = %s\\n' "$(cat ${sh(pid)})"; exit 0; fi
    echo "Could not find service"; exit 3 ;;
  bootstrap)
    ${sh(process.execPath)} -e ${sh(server)} >/dev/null 2>&1 &
    echo $! > ${sh(pid)}
    touch ${sh(marker)} ;;
  bootout)
    if [ -n "$STUB_REFUSE_BOOTOUT" ]; then echo "Boot-out failed: 5: Input/output error" >&2; exit 5; fi
    kill "$(cat ${sh(pid)})" 2>/dev/null
    rm -f ${sh(marker)} ${sh(pid)} ;;
  kickstart)
    touch ${sh(marker)} ;;
esac
exit 0
`,
  );
  await chmod(join(bin, "launchctl"), 0o755);
  return {
    root,
    state,
    file: join(home, "Library", "LaunchAgents", "com.tandem.server.plist"),
    record,
    env: {
      ...process.env,
      HOME: home,
      TANDEM_HOME: state,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TANDEM_PUBLIC_URL: "https://tandem.example.com",
    },
  };
}

function sh(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function service(args: readonly string[], where: Bench): { code: number | null; output: string } {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd: repository,
    env: where.env,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

const free = await portFree();

describe.skipIf(process.platform !== "darwin" || !free)("installing the service", () => {
  test("creates the state directory, writes the file, and leaves starting to launchd", async () => {
    const where = await bench();
    const installed = service(["install"], where);
    expect(installed.output).toMatch(/Tandem answers on http/);
    expect(installed.code).toBe(0);
    // The state directory holds the master key, so its mode is the project's, not whatever the service manager makes.
    expect((await stat(where.state)).mode & 0o777).toBe(0o700);
    const plist = await readFile(where.file, "utf8");
    expect(plist).toContain(`<string>${where.state}</string>`);
    expect(plist).toContain("<key>TANDEM_PUBLIC_URL</key>");
    expect(plist).toContain("<string>https://tandem.example.com</string>");
    // The old job goes before the new one comes: bootstrapping while the last one is still letting go fails.
    const calls = (await readFile(where.record, "utf8"))
      .split("\n")
      .filter((line) => /^(bootout|bootstrap) /.test(line));
    expect(calls[0]).toMatch(/^bootout /);
    expect(calls[1]).toMatch(/^bootstrap /);
    expect(service(["status"], where).output).toContain("The service is running");
  });

  test("refuses while a server that is not this service holds the port", async () => {
    const where = await bench();
    const other = spawn(
      process.execPath,
      ["-e", `require("node:http").createServer((request, response) => response.end("{}")).listen(${DEFAULT_PORT})`],
      { stdio: "ignore" },
    );
    spare.push(other);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const refused = service(["install"], where);
    expect(refused.code).not.toBe(0);
    expect(refused.output).toMatch(/already answers on port/);
    // Nothing was written and nothing was loaded: the service would have found that server and exited.
    expect(await readFile(where.file, "utf8").catch(() => "none")).toBe("none");
    expect(await readFile(where.record, "utf8").catch(() => "")).not.toMatch(/^bootstrap /m);
    expect(await stat(where.state).catch(() => undefined)).toBeUndefined();
  });

  test("uninstalls only once the service is really gone", async () => {
    const where = await bench();
    service(["install"], where);
    const refused = service(["uninstall"], { ...where, env: { ...where.env, STUB_REFUSE_BOOTOUT: "1" } });
    expect(refused.code).not.toBe(0);
    expect(refused.output).toMatch(/still there/);
    // The file stays: a service that could not be stopped must not be forgotten.
    expect((await stat(where.file)).isFile()).toBe(true);
    const removed = service(["uninstall"], where);
    expect(removed.code).toBe(0);
    expect(removed.output).toMatch(/Removed .*com\.tandem\.server\.plist/);
    expect(await readFile(where.file, "utf8").catch(() => "removed")).toBe("removed");
  });
});
