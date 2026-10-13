import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { describe, expect, test } from "vitest";
import type { ProjectPaths } from "../src/services/project-path.ts";
import { parsePullRequest, RepositoryBoard } from "../src/services/repository.ts";
import type { WorkspaceCatalog } from "../src/services/workspaces.ts";

const workspaces = { get: (id: number) => (id === 1 ? { id: 1 } : undefined) } as Pick<WorkspaceCatalog, "get">;

/** A project whose `gh` prints `stdout` and exits with `exitCode`. */
function board(stdout: string, exitCode = 0): RepositoryBoard {
  const env = {
    exec: async (
      _command: readonly string[],
      options: { onOutput?: (text: string, context: never, info: { stream: string }) => void },
    ) => {
      options.onOutput?.(stdout, undefined as never, { stream: "stdout" });
      return { ok: true, value: { exitCode } };
    },
  } as unknown as ExecutionEnv;
  const paths = {
    resolve: async () => ({ env, workspace: {}, path: "", target: "/tmp/project" }),
  } as unknown as Pick<ProjectPaths, "resolve">;
  return new RepositoryBoard(paths, workspaces);
}

describe("reading a pull request", () => {
  test("takes the number and the url, and nothing else", () => {
    expect(parsePullRequest('{"number":33,"url":"https://github.com/a/b/pull/33"}')).toEqual({
      number: 33,
      url: "https://github.com/a/b/pull/33",
    });
    expect(parsePullRequest("no pull requests found for branch")).toBeUndefined();
    expect(parsePullRequest('{"number":"33","url":"x"}')).toBeUndefined();
    expect(parsePullRequest('{"url":"https://github.com/a/b/pull/33"}')).toBeUndefined();
  });
});

describe("the repository board", () => {
  test("rejects invalid and unknown projects", async () => {
    const repository = board("");
    await expect(repository.refresh("1" as unknown as number, BACKGROUND_CONTEXT)).rejects.toThrow("integer");
    await expect(repository.refresh(2, BACKGROUND_CONTEXT)).rejects.toThrow("does not exist");
  });

  test("refuses unsafe links and invalid PR numbers", () => {
    for (const url of ["javascript:alert(1)", "file:///tmp/a", "invalid", "https://user:secret@example.com"]) {
      expect(parsePullRequest(JSON.stringify({ number: 1, url }))).toBeUndefined();
    }
    expect(parsePullRequest('{"number":0,"url":"https://example.com"}')).toBeUndefined();
    expect(parsePullRequest("null")).toBeUndefined();
  });

  test("limits collected output", async () => {
    const repository = board(JSON.stringify({ number: 1, url: `https://example.com/${"a".repeat(20_000)}` }));
    await repository.refresh(1, BACKGROUND_CONTEXT);
    expect(repository.state.value.projects[1]).toBeUndefined();
  });

  test("concurrent reads share a background task, not the caller context", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const paths = {
      resolve: async (_location: unknown, context: unknown) => {
        expect(context).toBe(BACKGROUND_CONTEXT);
        calls++;
        await gate;
        throw new Error("Unavailable directory");
      },
    } as unknown as Pick<ProjectPaths, "resolve">;
    const repository = new RepositoryBoard(paths, workspaces);
    const caller = {} as typeof BACKGROUND_CONTEXT;
    const first = repository.refresh(1, caller);
    const second = repository.refresh(1, caller);
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    await repository.refresh(1, caller);
    expect(calls).toBe(2);
  });
  test("holds the project's pull request once read", async () => {
    const repository = board('{"number":33,"url":"https://github.com/a/b/pull/33"}');
    await repository.refresh(1, BACKGROUND_CONTEXT);
    expect(repository.state.value.projects[1]).toEqual({ number: 33, url: "https://github.com/a/b/pull/33" });
  });

  test("a branch with no pull request, or a failing gh, leaves the project out", async () => {
    const none = board("no pull requests found for branch");
    await none.refresh(1, BACKGROUND_CONTEXT);
    expect(none.state.value.projects[1]).toBeUndefined();

    const failed = board("", 1);
    await failed.refresh(1, BACKGROUND_CONTEXT);
    expect(failed.state.value.projects[1]).toBeUndefined();
  });

  test("a later read that finds none forgets the earlier one", async () => {
    let stdout = '{"number":33,"url":"https://github.com/a/b/pull/33"}';
    const env = {
      exec: async (
        _command: readonly string[],
        options: { onOutput?: (text: string, context: never, info: { stream: string }) => void },
      ) => {
        options.onOutput?.(stdout, undefined as never, { stream: "stdout" });
        return { ok: true, value: { exitCode: 0 } };
      },
    } as unknown as ExecutionEnv;
    const paths = {
      resolve: async () => ({ env, workspace: {}, path: "", target: "/tmp/project" }),
    } as unknown as Pick<ProjectPaths, "resolve">;
    const repository = new RepositoryBoard(paths, workspaces);
    await repository.refresh(1, BACKGROUND_CONTEXT);
    expect(repository.state.value.projects[1]?.number).toBe(33);
    stdout = "";
    await repository.refresh(1, BACKGROUND_CONTEXT);
    expect(repository.state.value.projects[1]).toBeUndefined();
  });
});
