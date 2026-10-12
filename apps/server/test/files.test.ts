import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { connect, type TandemConnection } from "@tandem/client";
import { Files, MAX_FILE_VIEW_BYTES, Workspaces } from "@tandem/contracts";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { startApp } from "../src/app.ts";
import { createFauxProvider } from "../src/models.ts";
import type { TandemServer } from "../src/server.ts";

const context = BACKGROUND_CONTEXT;
let server: TandemServer;
let connection: TandemConnection;
let files: Files;
let project: string;
let workspaceId: number;

beforeEach(async () => {
  server = await startApp({
    port: 0,
    providers: [createFauxProvider()],
    stateDir: await mkdtemp(join(tmpdir(), "tandem-test-")),
  });
  connection = await connect({ baseUrl: server.url, token: server.token, services: [Workspaces, Files] });
  files = connection.services.use(Files);
  project = await mkdtemp(join(tmpdir(), "tandem-files-"));
  workspaceId = await connection.services.use(Workspaces).add({ path: project }, context);
});

afterEach(async () => {
  await connection.close();
  await server.stop();
});

const list = async (path: string) => files.list({ workspaceId, path }, context);
const read = async (path: string) => files.read({ workspaceId, path }, context);

describe("files", () => {
  test("a directory lists every entry, directories first, each by name", async () => {
    await mkdir(join(project, ".git"));
    await mkdir(join(project, "src"));
    await mkdir(join(project, "node_modules"));
    await writeFile(join(project, ".env"), "SECRET=1\n");
    await writeFile(join(project, "b.ts"), "");
    await writeFile(join(project, "a10.ts"), "");
    await writeFile(join(project, "a9.ts"), "");
    await writeFile(join(project, "src", "app.ts"), "");
    expect((await list("")).map((entry) => `${entry.kind} ${entry.path}`)).toEqual([
      "directory .git",
      "directory node_modules",
      "directory src",
      "file .env",
      "file a9.ts",
      "file a10.ts",
      "file b.ts",
    ]);
    expect(await list("./src/")).toEqual([{ name: "app.ts", path: "src/app.ts", kind: "file" }]);
  });

  test("a file reads as text, binary, or too large to show", async () => {
    await writeFile(join(project, "a.ts"), "const a = 1;\n");
    await writeFile(join(project, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    await writeFile(join(project, "big.log"), "x".repeat(MAX_FILE_VIEW_BYTES + 1));
    expect(await read("a.ts")).toEqual({ kind: "text", text: "const a = 1;\n", size: 13 });
    expect(await read("image.png")).toEqual({ kind: "binary", size: 6 });
    expect(await read("big.log")).toEqual({ kind: "tooLarge", size: MAX_FILE_VIEW_BYTES + 1 });
  });

  test("symbolic links show what they point to, and are followed only inside the project", async () => {
    const outside = await mkdtemp(join(tmpdir(), "tandem-outside-"));
    await writeFile(join(outside, "secret.txt"), "secret");
    await mkdir(join(project, "lib"));
    await writeFile(join(project, "lib", "util.ts"), "export {};\n");
    await symlink(join(project, "lib"), join(project, "lib-link"));
    await symlink(outside, join(project, "outside-link"));
    await symlink(join(outside, "secret.txt"), join(project, "secret-link"));
    await symlink(join(project, "missing"), join(project, "broken-link"));
    expect((await list("")).map((entry) => `${entry.kind} ${entry.path} ${entry.symlink ?? ""}`.trim())).toEqual([
      "directory lib",
      "directory lib-link true",
      "directory outside-link true",
      "file broken-link true",
      "file secret-link true",
    ]);
    expect(await list("lib-link")).toEqual([{ name: "util.ts", path: "lib-link/util.ts", kind: "file" }]);
    expect(await read("lib-link/util.ts")).toMatchObject({ kind: "text", text: "export {};\n" });
    await expect(list("outside-link")).rejects.toThrow("outside the project");
    await expect(read("secret-link")).rejects.toThrow("outside the project");
    await expect(read("broken-link")).rejects.toThrow("does not exist");
  });

  test("paths stay inside the project, and errors say what is wrong", async () => {
    await writeFile(join(project, "a.ts"), "");
    await expect(list("..")).rejects.toThrow("outside the project");
    await expect(read("src/../../etc/passwd")).rejects.toThrow("outside the project");
    await expect(read("/etc/passwd")).rejects.toThrow("relative to the project");
    await expect(read("missing.ts")).rejects.toThrow("missing.ts does not exist");
    await expect(read("")).rejects.toThrow("is a directory");
    await expect(list("a.ts")).rejects.toThrow("a.ts is not a directory");
    await expect(files.list({ workspaceId: 99, path: "" }, context)).rejects.toThrow("Project 99 does not exist");
  });
});
