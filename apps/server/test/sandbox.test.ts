import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/sandbox.sh", import.meta.url));
const repository = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const subprocessTimeoutMs = 10_000;
// Leave time for assertions and cleanup after the child reaches its own timeout.
const subprocessTestOptions = { timeout: 2 * subprocessTimeoutMs };
let root: string;

// Stand in for every external service so these tests never build images, start containers, or contact a server.
const fakeTool = `#!/bin/sh
set -eu
tool="\${0##*/}"
printf '%s\\t' "$tool" "$@" >> "$SANDBOX_TEST_LOG"
printf '\\n' >> "$SANDBOX_TEST_LOG"
invocation="$tool:$#:$*"
case "$invocation" in
  "docker:1:info" | "docker:2:compose version" | "docker:4:compose up -d --force-recreate" | \
  "docker:3:compose logs tandem" | "docker:7:compose exec tandem bun run service pair")
    ;;
  "docker:2:compose build" | "docker:3:compose build --no-cache" | \
  "docker:4:build -t tandem:latest $SANDBOX_TEST_REPOSITORY" | \
  "docker:5:build -t tandem:latest --no-cache $SANDBOX_TEST_REPOSITORY")
    if [ "$SANDBOX_TEST_FAIL_BUILD" = "1" ]; then exit 23; fi
    ;;
  "docker:4:save tandem:latest -o /tmp/tandem-build-"[0-9]*".tar") ;;
  "curl:2:-s http://127.0.0.1:4820/health") printf '{"status":"ok"}\\n' ;;
  "sbx:1:diagnose") printf 'Authentication authenticated\\n' ;;
  "sbx:2:template ls")
    if [ -f "$HOME/template-loaded" ]; then printf 'tandem latest\\n'; fi
    ;;
  "sbx:3:template load /tmp/tandem-build-"[0-9]*".tar") : > "$HOME/template-loaded" ;;
  "sbx:2:stop tandem-box" | "sbx:3:rm --force tandem-box" | "sbx:2:policy ls" | "sbx:1:ls") ;;
  "sbx:14:run --pull never -d --name tandem-box -p 127.0.0.1:4820:4820 -t tandem:latest shell $TANDEM_WORKSPACE_DIR $TANDEM_DATA_DIR $PI_PROMPTS_DIR") ;;
  "sbx:6:exec tandem-box grep -oE https?://[^[:space:]]+/pair#[a-f0-9]+ /tmp/tandem.log" | \
  "sbx:6:exec tandem-box bun run service pair") ;;
  *)
    printf 'Unexpected fake-tool invocation: %s\\n' "$invocation" >&2
    printf '%s\\n' "$invocation" >> "$SANDBOX_TEST_UNEXPECTED"
    exit 64
    ;;
esac
`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tandem-sandbox-test-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  await mkdir(join(root, "home"));
  await writeFile(join(root, "calls"), "");
  await writeFile(join(root, "unexpected-calls"), "");
  await Promise.all(
    ["docker", "sbx", "curl", "open"].map(async (tool) => {
      const path = join(bin, tool);
      await writeFile(path, fakeTool);
      await chmod(path, 0o755);
    }),
  );
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

function sandboxEnvironment(runtime: "docker" | "sbx", failBuild = false) {
  return {
    ...process.env,
    PATH: `${join(root, "bin")}${delimiter}${process.env.PATH ?? ""}`,
    HOME: join(root, "home"),
    TANDEM_HOME: join(root, "state"),
    TANDEM_DATA_DIR: join(root, "state"),
    TANDEM_WORKSPACE_DIR: join(root, "workspace"),
    PI_PROMPTS_DIR: join(root, "prompts"),
    TANDEM_RUNTIME: runtime,
    PORT: "4820",
    SANDBOX_TEST_LOG: join(root, "calls"),
    SANDBOX_TEST_UNEXPECTED: join(root, "unexpected-calls"),
    SANDBOX_TEST_REPOSITORY: repository,
    SANDBOX_TEST_FAIL_BUILD: failBuild ? "1" : "0",
  };
}

async function runSandbox(runtime: "docker" | "sbx", args: string[], failBuild = false) {
  const result = spawnSync("bash", [script, ...args], {
    cwd: root,
    env: sandboxEnvironment(runtime, failBuild),
    encoding: "utf8",
    timeout: subprocessTimeoutMs,
  });
  expect(result.error).toBeUndefined();
  // The runner intentionally ignores some tool failures, so also check the persistent rejection log.
  expect(await readFile(join(root, "unexpected-calls"), "utf8"), result.stderr).toBe("");
  const calls: string[][] = (await readFile(join(root, "calls"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t").slice(0, -1));
  return { result, calls };
}

function builds(calls: string[][]) {
  return calls.filter(
    ([tool, first, second]) => tool === "docker" && (first === "build" || (first === "compose" && second === "build")),
  );
}

test.each(["docker", "sbx"] as const)(
  "%s rebuild uses cached layers by default",
  subprocessTestOptions,
  async (runtime) => {
    const { result, calls } = await runSandbox(runtime, ["rebuild"]);
    expect(result.status, result.stderr).toBe(0);
    expect(builds(calls)).toHaveLength(1);
    expect(builds(calls)[0]).not.toContain("--no-cache");
    if (runtime === "docker") {
      expect(builds(calls)[0]).toEqual(["docker", "compose", "build"]);
      expect(calls).toContainEqual(["docker", "compose", "up", "-d", "--force-recreate"]);
    } else {
      expect(builds(calls)[0]).toContain("tandem:latest");
      expect(calls).toContainEqual(["sbx", "template", "load", expect.any(String)]);
      expect(calls).toContainEqual(["sbx", "rm", "--force", "tandem-box"]);
      expect(calls.some(([tool, command]) => tool === "sbx" && command === "run")).toBe(true);
    }
    expect(calls.some(([tool]) => tool === "curl")).toBe(true);
    expect(result.stdout).toContain("Web Interface:");
  },
);

test.each(["docker", "sbx"] as const)(
  "%s rebuild --no-cache explicitly disables cached layers",
  subprocessTestOptions,
  async (runtime) => {
    const { result, calls } = await runSandbox(runtime, ["rebuild", "--no-cache"]);
    expect(result.status, result.stderr).toBe(0);
    expect(builds(calls)).toHaveLength(1);
    expect(builds(calls)[0]).toContain("--no-cache");
    if (runtime === "docker") {
      expect(builds(calls)[0]).toEqual(["docker", "compose", "build", "--no-cache"]);
      expect(calls).toContainEqual(["docker", "compose", "up", "-d", "--force-recreate"]);
    } else {
      expect(calls).toContainEqual(["sbx", "template", "load", expect.any(String)]);
      expect(calls.some(([tool, command]) => tool === "sbx" && command === "run")).toBe(true);
    }
  },
);

test.each(["docker", "sbx"] as const)(
  "%s rebuild leaves the existing instance alone if the build fails",
  subprocessTestOptions,
  async (runtime) => {
    const { result, calls } = await runSandbox(runtime, ["rebuild"], true);
    expect(result.status).toBe(23);
    expect(builds(calls)).toHaveLength(1);
    expect(
      calls.some(
        ([tool, first, second]) =>
          tool === "docker" && first === "compose" && ["up", "stop", "down", "restart", "rm"].includes(second ?? ""),
      ),
    ).toBe(false);
    expect(calls.some(([tool, command]) => tool === "sbx" && ["stop", "rm", "run"].includes(command ?? ""))).toBe(
      false,
    );
    expect(calls.some(([tool]) => tool === "curl")).toBe(false);
  },
);

test.each([
  { args: ["rebuild", "--unknown"] },
  { args: ["start", "--no-cache"] },
  { args: ["rebuild", "--no-cache", "extra"] },
  { args: ["rebuild", "--no-cache", "--no-cache"] },
])("rejects unsupported arguments before invoking external tools: $args", subprocessTestOptions, async ({ args }) => {
  const { result, calls } = await runSandbox("docker", args);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Unexpected arguments");
  expect(result.stdout).toContain("rebuild [--no-cache]");
  expect(calls).toEqual([]);
});

test.each([
  { tool: "docker", args: ["compose", "down", "-v"] },
  { tool: "docker", args: ["compose", "build", "--unexpected"] },
  { tool: "sbx", args: ["unknown"] },
  { tool: "curl", args: ["-s", "https://example.com"] },
  { tool: "open", args: ["https://example.com"] },
])("the $tool stand-in rejects unexpected arguments: $args", subprocessTestOptions, async ({ tool, args }) => {
  const result = spawnSync(join(root, "bin", tool), args, {
    cwd: root,
    env: sandboxEnvironment("docker"),
    encoding: "utf8",
    timeout: subprocessTimeoutMs,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(64);
  expect(result.stderr).toContain("Unexpected fake-tool invocation:");
  expect(await readFile(join(root, "unexpected-calls"), "utf8")).toBe(`${tool}:${args.length}:${args.join(" ")}\n`);
});
