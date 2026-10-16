import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/sandbox.sh", import.meta.url));
let root: string;

// Stand in for every external service so these tests never build images, start containers, or contact a server.
const fakeTool = `#!/bin/sh
tool="\${0##*/}"
printf '%s\\t' "$tool" "$@" >> "$SANDBOX_TEST_LOG"
printf '\\n' >> "$SANDBOX_TEST_LOG"
case "$tool" in
  docker)
    if [ "$SANDBOX_TEST_FAIL_BUILD" = "1" ]; then
      if [ "$1" = "build" ] || { [ "$1" = "compose" ] && [ "$2" = "build" ]; }; then exit 23; fi
    fi
    ;;
  curl) printf '{"status":"ok"}\\n' ;;
  sbx)
    case "$1 \${2:-}" in
      "diagnose ") printf 'Authentication authenticated\\n' ;;
      "template load") : > "$HOME/template-loaded" ;;
      "template ls") if [ -f "$HOME/template-loaded" ]; then printf 'tandem latest\\n'; fi ;;
    esac
    ;;
esac
exit 0
`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tandem-sandbox-test-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  await mkdir(join(root, "home"));
  await writeFile(join(root, "calls"), "");
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

async function runSandbox(runtime: "docker" | "sbx", args: string[], failBuild = false) {
  const result = spawnSync("bash", [script, ...args], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${join(root, "bin")}${delimiter}${process.env.PATH ?? ""}`,
      HOME: join(root, "home"),
      TANDEM_HOME: join(root, "state"),
      TANDEM_DATA_DIR: join(root, "state"),
      TANDEM_WORKSPACE_DIR: join(root, "workspace"),
      TANDEM_RUNTIME: runtime,
      PORT: "4820",
      SANDBOX_TEST_LOG: join(root, "calls"),
      SANDBOX_TEST_FAIL_BUILD: failBuild ? "1" : "0",
    },
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
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

test.each(["docker", "sbx"] as const)("%s rebuild uses cached layers by default", async (runtime) => {
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
});

test.each(["docker", "sbx"] as const)("%s rebuild --no-cache explicitly disables cached layers", async (runtime) => {
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
});

test.each(["docker", "sbx"] as const)(
  "%s rebuild leaves the existing instance alone if the build fails",
  async (runtime) => {
    const { result, calls } = await runSandbox(runtime, ["rebuild"], true);
    expect(result.status).toBe(23);
    expect(builds(calls)).toHaveLength(1);
    expect(calls.some(([tool, first, second]) => tool === "docker" && first === "compose" && second === "up")).toBe(
      false,
    );
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
])("rejects unsupported arguments before invoking external tools: $args", async ({ args }) => {
  const { result, calls } = await runSandbox("docker", args);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Unexpected arguments");
  expect(result.stdout).toContain("rebuild [--no-cache]");
  expect(calls).toEqual([]);
});
