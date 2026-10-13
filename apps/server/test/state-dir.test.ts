import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { writeJsonFile } from "../src/json-file.ts";
import { openStateDir } from "../src/state-dir.ts";

test("migration rotates the browser-distributed legacy key once and preserves installation identity", async () => {
  const home = await mkdtemp(join(tmpdir(), "tandem-auth-migration-"));
  const file = join(home, "server.json");
  await writeJsonFile(file, { serverId: "installation", token: "old-url-token" });
  const first = await openStateDir(home);
  const identity = first.identity;
  await first.release();
  expect(identity.serverId).toBe("installation");
  expect(identity.token).not.toBe("old-url-token");
  expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ authVersion: 2 });
  const second = await openStateDir(home);
  try {
    expect(second.identity).toEqual(identity);
  } finally {
    await second.release();
  }
});
