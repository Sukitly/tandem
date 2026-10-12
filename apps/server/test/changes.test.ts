import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { connect, type TandemConnection } from "@tandem/client";
import { Changes, type ChangesState, ProjectChanges, Workspaces } from "@tandem/contracts";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { startApp } from "../src/app.ts";
import { createFauxProvider } from "../src/models.ts";
import type { TandemServer } from "../src/server.ts";

const run = promisify(execFile);
const context = BACKGROUND_CONTEXT;
let server: TandemServer;
let connection: TandemConnection;
let project: string;
let workspaceId: number;
/** The open projects, by project ID; a service handle must not be awaited, so it is read from here. */
const instances = new Map<number, ProjectChanges>();

beforeEach(async () => {
  server = await startApp({
    port: 0,
    providers: [createFauxProvider()],
    stateDir: await mkdtemp(join(tmpdir(), "tandem-test-")),
  });
  connection = await connect({
    baseUrl: server.url,
    token: server.token,
    services: [Workspaces, Changes, ProjectChanges],
  });
  project = await mkdtemp(join(tmpdir(), "tandem-changes-"));
  workspaceId = await connection.services.use(Workspaces).add({ path: project }, context);
  instances.clear();
  connection.services.observe(ProjectChanges, (observed, instanceContext) => {
    const id = observed.state.value?.workspaceId;
    if (id === undefined) return;
    instances.set(id, observed);
    instanceContext.abortSignal?.addEventListener("abort", () => {
      if (instances.get(id) === observed) instances.delete(id);
    });
  });
});

afterEach(async () => {
  await connection.close();
  await server.stop();
});

/** The changes of the project, once the panel would have them. Wrapped: a service handle must not be awaited. */
async function openChanges(id: number = workspaceId): Promise<{ changes: ProjectChanges }> {
  await connection.services.use(Changes).open(id, context);
  await waitFor(() => instances.get(id)?.state.value !== undefined);
  return { changes: instances.get(id) as ProjectChanges };
}

/** A project in a repository: a `main` branch with one commit, and the current `feature` branch on top of it. */
async function repository(): Promise<{ base: string }> {
  const git = (args: string[]) => run("git", args, { cwd: project });
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.email", "tandem@example.com"]);
  await git(["config", "user.name", "Tandem"]);
  await writeFile(join(project, "keep.ts"), "one\ntwo\n");
  await writeFile(join(project, "gone.ts"), "bye\n");
  await writeFile(join(project, "old-name.ts"), "same\n");
  await git(["add", "-A"]);
  await git(["commit", "-qm", "base"]);
  const { stdout } = await git(["rev-parse", "HEAD"]);
  await git(["switch", "-qc", "feature"]);
  return { base: stdout.trim() };
}

async function state(): Promise<ChangesState> {
  const { changes } = await openChanges();
  await connection.services.ready(context);
  return JSON.parse(JSON.stringify(changes.state.value)) as ChangesState;
}

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("changes", () => {
  test("a directory that is not a repository reports it", async () => {
    const current = await state();
    expect(current.status).toBe("notRepository");
    expect(current.files).toEqual([]);
    expect(current.message).toContain("not in a Git repository");
  });

  test("every kind of change is listed, measured from the integration branch", async () => {
    await repository();
    await writeFile(join(project, "keep.ts"), "one\nTWO\n");
    await writeFile(join(project, "added.ts"), "a\nb\n");
    await writeFile(join(project, "untracked.ts"), "x\ny\nz\n");
    await run("git", ["rm", "-q", "gone.ts"], { cwd: project });
    await run("git", ["mv", "old-name.ts", "new-name.ts"], { cwd: project });
    await run("git", ["add", "added.ts"], { cwd: project });
    // A commit on the branch is part of the changes too: the base is the fork point, not `HEAD`.
    await run("git", ["commit", "-qm", "work"], { cwd: project });

    const current = await state();
    expect(current.status).toBe("ready");
    expect(current.base).toBe("main");
    expect(current.files).toEqual([
      { path: "added.ts", status: "added", additions: 2, deletions: 0 },
      { path: "gone.ts", status: "deleted", additions: 0, deletions: 1 },
      { path: "keep.ts", status: "modified", additions: 1, deletions: 1 },
      { path: "new-name.ts", status: "renamed", from: "old-name.ts", additions: 0, deletions: 0 },
      { path: "untracked.ts", status: "untracked", additions: 3 },
    ]);
  });

  test("a repository without a commit yet lists what the index and the directory hold", async () => {
    await run("git", ["init", "-q", "-b", "main"], { cwd: project });
    await writeFile(join(project, "a.ts"), "a\n");
    await writeFile(join(project, "b.ts"), "b\nc\n");
    await run("git", ["add", "a.ts"], { cwd: project });
    const current = await state();
    expect(current.status).toBe("ready");
    expect(current.base).toBe("HEAD");
    expect(current.files).toEqual([
      { path: "a.ts", status: "added", additions: 1, deletions: 0 },
      { path: "b.ts", status: "untracked", additions: 2 },
    ]);
  });

  test("a binary file and one too large to count have no line counts", async () => {
    await run("git", ["init", "-q", "-b", "main"], { cwd: project });
    await writeFile(join(project, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    await writeFile(join(project, "big.log"), `${"x".repeat(600 * 1024)}\n`);
    const current = await state();
    expect(current.files).toEqual([
      { path: "big.log", status: "untracked" },
      { path: "image.png", status: "untracked" },
    ]);
  });

  test("a file's diff is a patch, and a binary file has none", async () => {
    await repository();
    await writeFile(join(project, "keep.ts"), "one\nTWO\nthree\n");
    await writeFile(join(project, "untracked.ts"), "x\ny\n");
    await writeFile(join(project, "image.png"), Buffer.from([0x00, 0x01, 0x02]));
    const { changes } = await openChanges();
    await state();

    const patch = await changes.diff("keep.ts", context);
    expect(patch.kind).toBe("patch");
    expect(patch.kind === "patch" && patch.patch).toContain("+TWO");
    expect(patch.kind === "patch" && patch.patch).toContain("--- a/keep.ts");

    const untracked = await changes.diff("untracked.ts", context);
    expect(untracked.kind === "patch" && untracked.patch).toContain("new file mode");
    expect(untracked.kind === "patch" && untracked.patch).toContain("+y");

    expect(await changes.diff("image.png", context)).toEqual({ kind: "binary" });
  });

  test("a path outside the project is refused", async () => {
    await repository();
    const { changes } = await openChanges();
    await expect(changes.diff("../../etc/hosts", context)).rejects.toThrow("outside the project");
    await expect(changes.diff("/etc/hosts", context)).rejects.toThrow("relative to the project");
  });

  test("a change on disk reaches the list without asking", async () => {
    await repository();
    expect((await state()).files).toEqual([]);
    await writeFile(join(project, "keep.ts"), "one\nTWO\n");
    const { changes } = await openChanges();
    await waitFor(() => (changes.state.value as ChangesState).files.length > 0);
    expect((changes.state.value as ChangesState).files).toEqual([
      { path: "keep.ts", status: "modified", additions: 1, deletions: 1 },
    ]);
    // The patch is read again too, so an edit that follows the first one shows up.
    await writeFile(join(project, "keep.ts"), "one\nTWO\nthree\n");
    const first = await changes.diff("keep.ts", context);
    expect(first.kind === "patch" && first.patch).toContain("+three");
  });

  test("a project that is a subdirectory of its repository reports its own paths", async () => {
    const git = (args: string[]) => run("git", args, { cwd: project });
    await git(["init", "-q", "-b", "main"]);
    await git(["config", "user.email", "tandem@example.com"]);
    await git(["config", "user.name", "Tandem"]);
    const inner = join(project, "inner");
    await mkdir(inner);
    await writeFile(join(project, "root.ts"), "r\n");
    await writeFile(join(inner, "tracked.ts"), "one\n");
    await git(["add", "-A"]);
    await git(["commit", "-qm", "base"]);
    await writeFile(join(inner, "tracked.ts"), "one\nTWO\n");
    await writeFile(join(inner, "a.ts"), "a\n");

    const innerId = await connection.services.use(Workspaces).add({ path: inner }, context);
    const { changes } = await openChanges(innerId);
    await waitFor(() => (changes.state.value as ChangesState).files.length === 2);
    // The file beside the project is not its change; the two inside it are, by their own paths.
    expect((changes.state.value as ChangesState).files).toEqual([
      { path: "a.ts", status: "untracked", additions: 1 },
      { path: "tracked.ts", status: "modified", additions: 1, deletions: 0 },
    ]);
    const patch = await changes.diff("tracked.ts", context);
    expect(patch.kind === "patch" && patch.patch).toContain("a/tracked.ts");
    expect(patch.kind === "patch" && patch.patch).toContain("+TWO");
  });

  test("closing a project stops its watcher", async () => {
    await repository();
    const { changes } = await openChanges();
    expect(changes.state.value?.workspaceId).toBe(workspaceId);
    await connection.services.use(Changes).close(workspaceId, context);
    await waitFor(() => !instances.has(workspaceId));
    expect(instances.has(workspaceId)).toBe(false);
  });
});
