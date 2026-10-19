import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";

const repository = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "tandem-update-test-"));
});

afterEach(async () => {
  if (tempDir && existsSync(tempDir)) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("self-update --detach spawns background worker and creates log file in TANDEM_HOME", async () => {
  const scriptPath = join(repository, "scripts", "self-update.sh");
  const stateDir = join(tempDir, "state");
  await mkdir(stateDir, { recursive: true });

  const result = spawnSync("bash", [scriptPath, "--detach", "--no-pull", "--no-test", "--timeout", "1"], {
    cwd: repository,
    env: {
      ...process.env,
      TANDEM_HOME: stateDir,
      TANDEM_NO_ROLLBACK_RESET: "1",
    },
    encoding: "utf8",
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("[Tandem Updater]");
  expect(result.stdout).toContain("Detached");

  const logFile = join(stateDir, "update.log");
  // Give background worker a brief moment to write its initial log
  let logContent = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    if (existsSync(logFile)) {
      logContent = await readFile(logFile, "utf8");
      if (logContent.length > 0) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  expect(existsSync(logFile)).toBe(true);
  expect(logContent).toContain("Initiating Tandem update sequence");
});
