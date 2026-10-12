import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { connect, type TandemConnection } from "@tandem/client";
import { Changes, type ChangesState, Conversation, Conversations, ProjectChanges, Workspaces } from "@tandem/contracts";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { startApp } from "../src/app.ts";
import { createFauxProvider } from "../src/models.ts";
import type { TandemServer } from "../src/server.ts";
import { ChangeTrackers, ProjectChangeTracker } from "../src/services/changes.ts";
import { ChangeReader } from "../src/services/changes-git.ts";
import type { ProjectPaths } from "../src/services/project-path.ts";

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
    services: [Workspaces, Changes, ProjectChanges, Conversations, Conversation],
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

  test("an uncommitted merge is measured from the branch it merges, not from the fork point", async () => {
    const git = (args: string[]) => run("git", args, { cwd: project });
    await git(["init", "-q", "-b", "main"]);
    await git(["config", "user.email", "tandem@example.com"]);
    await git(["config", "user.name", "Tandem"]);
    await writeFile(join(project, "base.ts"), "base\n");
    await git(["add", "-A"]);
    await git(["commit", "-qm", "base"]);
    await git(["switch", "-qc", "feature"]);
    await writeFile(join(project, "feature.ts"), "feature\n");
    await git(["add", "-A"]);
    await git(["commit", "-qm", "feature"]);
    // The integration branch moves on after the fork, then the merge into `feature` stops before committing.
    await git(["switch", "-q", "main"]);
    await writeFile(join(project, "upstream.ts"), "upstream\n");
    await git(["add", "-A"]);
    await git(["commit", "-qm", "upstream"]);
    await git(["switch", "-q", "feature"]);
    await git(["merge", "--no-commit", "main"]);

    const current = await state();
    expect(current.base).toBe("main");
    // The merged-in file belongs to the branch, not to this project's own work.
    expect(current.files).toEqual([{ path: "feature.ts", status: "added", additions: 1, deletions: 0 }]);
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

  test("a diff Git cannot read is an outcome, while a path it may not read is refused", async () => {
    // The directory is not a repository: the list says so, and asking for a diff says why instead of rejecting.
    const { changes } = await openChanges();
    await writeFile(join(project, "a.ts"), "a\n");
    const patch = await changes.diff("a.ts", context);
    expect(patch.kind).toBe("unavailable");
    // Git's own words, whatever they are for this case.
    expect(patch.kind === "unavailable" && patch.message.length > 0).toBe(true);

    await expect(changes.diff("../a.ts", context)).rejects.toThrow("outside the project");
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

  describe("the projects' trackers", () => {
    test("a project is tracked once, however many holds it has, and ended by its last one", async () => {
      const project = await mkdtemp(join(tmpdir(), "tandem-trackers-"));
      await run("git", ["init", "-q", "-b", "main"], { cwd: project });
      const env = new NodeExecutionEnv({ cwd: project });
      const paths: Pick<ProjectPaths, "resolve"> = {
        resolve: async () => ({
          env,
          workspace: { id: 1, path: project, name: basename(project) },
          path: "",
          target: project,
        }),
      };
      const trackers = new ChangeTrackers(paths);
      try {
        const first = await trackers.acquire(1, context);
        const second = await trackers.acquire(1, context);
        expect(second.tracker).toBe(first.tracker);

        // One hold given up leaves the other's changes followed.
        await first.release();
        await writeFile(join(project, "a.ts"), "a\n");
        await waitFor(() => first.tracker.state.value.files.length === 1);

        // A hold taken later, and a hold given up twice: only the last one ends the tracker.
        const third = await trackers.acquire(1, context);
        await second.release();
        await first.release();
        await writeFile(join(project, "b.ts"), "b\n");
        await waitFor(() => third.tracker.state.value.files.length === 2);

        await third.release();
        await writeFile(join(project, "c.ts"), "c\n");
        await new Promise((resolve) => setTimeout(resolve, 800));
        expect(third.tracker.state.value.files.length).toBe(2);

        // A project watched again is read from scratch, with what changed in between.
        const again = await trackers.acquire(1, context);
        expect(again.tracker).not.toBe(first.tracker);
        await waitFor(() => again.tracker.state.value.files.length === 3);
        await again.release();
      } finally {
        await trackers.dispose();
        await env.cleanup(context);
      }
    });
  });

  /** An execution environment that records what was asked of it. */
  function counted(env: ExecutionEnv): { env: ExecutionEnv; calls: string[] } {
    const calls: string[] = [];
    const proxy = new Proxy(env, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          calls.push(property === "exec" ? (args[0] as string[]).join(" ") : String(property));
          return (value as (...passed: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    return { env: proxy as ExecutionEnv, calls };
  }

  describe("reading a project's changes", () => {
    test("what a read cannot change is asked once, and forgetting asks again", async () => {
      const project = await mkdtemp(join(tmpdir(), "tandem-reader-"));
      await run("git", ["init", "-q", "-b", "main"], { cwd: project });
      await writeFile(join(project, "tracked.ts"), "a\n");
      await writeFile(join(project, "untracked.ts"), "one\ntwo\n");
      await run("git", ["add", "tracked.ts"], { cwd: project });

      const { env, calls } = counted(new NodeExecutionEnv({ cwd: project }));
      try {
        const reader = new ChangeReader(env, project);
        const first = await reader.read(context);
        expect(first.status).toBe("ready");
        const afterFirst = calls.length;
        const counted1 = calls.filter((call) => call === "openBinaryReader").length;
        expect(counted1).toBe(1);

        // Nothing about the branch or the untracked file changed, so only the list itself is asked again: the base
        // commit, the two diff summaries, the untracked listing, and whether a merge is in progress.
        calls.length = 0;
        const second = await reader.read(context);
        expect(second).toEqual(first);
        expect(calls.some((call) => call.includes("symbolic-ref"))).toBe(false);
        expect(calls.filter((call) => call === "openBinaryReader")).toEqual([]);
        expect(calls.length).toBeLessThanOrEqual(6);
        expect(calls.length).toBeLessThan(afterFirst);

        // The user asking again asks everything again.
        calls.length = 0;
        reader.forget();
        await reader.read(context);
        expect(calls.some((call) => call.includes("symbolic-ref"))).toBe(true);
        expect(calls.filter((call) => call === "openBinaryReader").length).toBe(1);
      } finally {
        await env.cleanup(context);
      }
    });
  });

  describe("the tracker on its own", () => {
    test("a burst of changes is read once, and nothing follows a disposed tracker", async () => {
      const project = await mkdtemp(join(tmpdir(), "tandem-tracker-"));
      await run("git", ["init", "-q", "-b", "main"], { cwd: project });
      const env = new NodeExecutionEnv({ cwd: project });
      const paths: Pick<ProjectPaths, "resolve"> = {
        resolve: async () => ({
          env,
          workspace: { id: 1, path: project, name: basename(project) },
          path: "",
          target: project,
        }),
      };
      const errors: Error[] = [];
      const tracker = await ProjectChangeTracker.open(1, paths, context, (error) => errors.push(error));
      try {
        let reads = 0;
        tracker.state.subscribe(() => {
          reads += 1;
        });
        // Let the subscription's first delivery pass before counting reads of its own.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const before = reads;

        for (const name of ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]) await writeFile(join(project, name), "x\n");
        await waitFor(() => tracker.state.value.files.length === 5);
        expect(reads - before).toBeLessThanOrEqual(2);

        tracker.dispose();
        const after = reads;
        await writeFile(join(project, "f.ts"), "y\n");
        await new Promise((resolve) => setTimeout(resolve, 800));
        expect(reads).toBe(after);
        expect(errors).toEqual([]);
      } finally {
        tracker.dispose();
        await env.cleanup(context);
      }
    });
  });

  test("a project's changes and a conversation live on the same connection", async () => {
    await repository();
    const { changes } = await openChanges();
    expect(changes.state.value?.workspaceId).toBe(workspaceId);

    const conversations = connection.services.use(Conversations);
    const opened: number[] = [];
    connection.services.observe(Conversation, (conversation, instanceContext) => {
      const id = conversation.view.value?.conversation.id;
      if (id !== undefined) opened.push(id);
      instanceContext.abortSignal?.addEventListener("abort", () => {});
    });
    const id = await conversations.start({ workspaceId, text: "where is it?" }, context);
    await conversations.open(id, context);
    await waitFor(() => opened.includes(id));
    expect(opened).toEqual([id]);
    // Starting a conversation leaves the project's changes alone.
    expect(changes.state.value?.workspaceId).toBe(workspaceId);
    await conversations.close(id, context);
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
