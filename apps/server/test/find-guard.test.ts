import { execFile } from "node:child_process";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ToolCall } from "@earendil-works/pi-ai";
import type { ToolHooks } from "@earendil-works/pi-durable";
import { describe, expect, test } from "vitest";
import {
  FIND_DISABLED_MESSAGE,
  findGuard,
  isExplicitFindInvocation,
  prependFindShimPath,
  shellQuote,
  writeFindShim,
} from "../src/find-guard.ts";

const run = promisify(execFile);

const blocked = [
  "/usr/bin/find . -type f",
  "echo ok && /usr/bin/find . -type f",
  "$(/usr/bin/find . -type f)",
  "sudo /usr/bin/find . -type f",
  "if /usr/bin/find . -type f; then echo ok; fi",
  "if true; then /usr/bin/find . -type f; fi",
  "`/usr/bin/find . -type f`",
];

const allowed = [
  "find . -type f",
  "rg a; find b .",
  "cat > notes.md <<EOF\nfind the config file first\nEOF",
  "cat > notes.md <<EOF\n/usr/bin/find is documented here\nEOF",
  "git commit -F - <<EOF\nfix search\n\nfind was slow\nEOF",
  "echo 'line1\n/usr/bin/find me\nline3' > a.txt",
  "printf '%s\\n' '/usr/bin/find . -type f'",
  "# /usr/bin/find . -type f\necho ok",
];

describe("the explicit find classifier", () => {
  test("blocks path-qualified command invocations", () => {
    for (const command of blocked) expect(isExplicitFindInvocation(command), command).toBe(true);
  });

  test("allows bare find and non-command text", () => {
    for (const command of allowed) expect(isExplicitFindInvocation(command), command).toBe(false);
  });
});

describe("the find shim", () => {
  test("is executable, prints the policy, and fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tandem-find-"));
    const policy = await writeFindShim(directory);
    const mode = (await stat(join(directory, "find"))).mode & 0o777;
    expect(mode & 0o111).not.toBe(0);

    await expect(run(join(directory, "find"), [])).rejects.toMatchObject({
      code: 1,
      stderr: `${FIND_DISABLED_MESSAGE}\n`,
    });
    expect(policy.message).toBe(FIND_DISABLED_MESSAGE);
  });

  test("shellQuote preserves literal paths with shell metacharacters", async () => {
    const value = "/tmp/a b'c$HOME`echo-no`";
    const { stdout } = await run("/bin/bash", ["-c", `value=${shellQuote(value)}; printf %s "$value"`]);
    expect(stdout).toBe(value);
  });

  test("the rewritten PATH routes a bare find to the shim, and is applied once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tandem-find-"));
    const policy = await writeFindShim(directory);
    const command = prependFindShimPath("find . -type f", policy.shimDirectory);
    expect(prependFindShimPath(command, policy.shimDirectory)).toBe(command);
    await expect(run("/bin/bash", ["-c", command])).rejects.toMatchObject({ code: 1 });
  });
});

describe("the find guard extension", () => {
  test("blocks an explicit find and rewrites a bare one, and only for bash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tandem-find-"));
    const policy = await writeFindShim(directory);
    const registration = findGuard(policy).hooks?.[0];
    expect(registration?.task).toBe("pi.tool");
    const handlers = registration?.handlers as ToolHooks;
    const before = handlers.beforeTool;

    const explicit = call("bash", "/usr/bin/find . -type f");
    expect(await before(explicit, {} as never, {} as never)).toEqual({ block: FIND_DISABLED_MESSAGE });

    const bare = call("bash", "find . -type f");
    const rewritten = await before(bare, {} as never, {} as never);
    if (rewritten === undefined) throw new Error("a bare find was not rewritten");
    expect((rewritten.arguments as { command: string }).command).toContain(policy.shimDirectory);

    const other = call("read", "find.txt");
    expect(await before(other, {} as never, {} as never)).toBeUndefined();
  });
});

function call(name: string, command: string): ToolCall {
  return { type: "toolCall", id: "call-1", name, arguments: { command } };
}
