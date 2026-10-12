import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, parse } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { err, FileError } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { connect, type TandemConnection } from "@tandem/client";
import { Workspaces } from "@tandem/contracts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { startApp } from "../src/app.ts";
import { createFauxProvider } from "../src/models.ts";
import type { TandemServer } from "../src/server.ts";
import { ProjectDirectoryBrowser } from "../src/services/project-directories.ts";

const context = BACKGROUND_CONTEXT;
let root: string;
let env: NodeExecutionEnv;
let browser: ProjectDirectoryBrowser;
let server: TandemServer | undefined;
let connection: TandemConnection | undefined;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "tandem-directories-")));
  env = new NodeExecutionEnv({ cwd: root });
  browser = new ProjectDirectoryBrowser(env);
});

afterEach(async () => {
  await connection?.close();
  connection = undefined;
  await server?.stop();
  server = undefined;
  await env.cleanup(context);
  await rm(root, { recursive: true, force: true });
});

describe("project directory selection", () => {
  test("lists only directories, including hidden ones, in natural name order", async () => {
    for (const name of ["project10", "project2", ".hidden"]) await mkdir(join(root, name));
    await writeFile(join(root, "README.md"), "Not a directory");
    const result = await browser.browse(root, context);
    expect(result).toEqual({
      path: root,
      parent: dirname(root),
      directories: [".hidden", "project2", "project10"].map((name) => ({ name, path: join(root, name) })),
    });
    expect(await browser.browse(join(root, "project2"), context)).toEqual({
      path: join(root, "project2"),
      parent: root,
      directories: [],
    });
  });

  test("opens the server's home by default and stops parent navigation at a filesystem root", async () => {
    expect((await browser.browse(null, context)).path).toBe(await realpath(homedir()));
    const filesystemRoot = parse(root).root;
    expect((await browser.browse(filesystemRoot, context)).parent).toBeNull();
  });

  test("follows directory links but excludes file links and broken links", async () => {
    const target = join(root, "target");
    await mkdir(target);
    await writeFile(join(root, "file.txt"), "text");
    await symlink(target, join(root, "alias"), "dir");
    await symlink(join(root, "file.txt"), join(root, "file-link"), "file");
    await symlink(join(root, "missing"), join(root, "broken"), "dir");
    expect((await browser.browse(root, context)).directories.map((entry) => entry.name)).toEqual(["alias", "target"]);
    expect((await browser.browse(join(root, "alias"), context)).path).toBe(target);
  });

  test("rejects invalid JSON arguments, missing directories, and files", async () => {
    for (const input of [undefined, {}, 1, "", "relative/path", `${root}\0bad`]) {
      await expect(browser.browse(input, context)).rejects.toThrow("absolute path or null");
    }
    await expect(browser.browse(join(root, "missing"), context)).rejects.toThrow("does not exist");
    await writeFile(join(root, "file.txt"), "text");
    await expect(browser.browse(join(root, "file.txt"), context)).rejects.toThrow("not a directory");
  });

  test("reports unreadable directories as service errors", async () => {
    vi.spyOn(env, "listDir").mockResolvedValueOnce(err(new FileError("permission_denied", "denied", root)));
    await expect(browser.browse(root, context)).rejects.toThrow(`Permission denied: ${root}`);
  });

  test("browses through authenticated RPC and adds the chosen directory without browsing creating a project", async () => {
    const projectPath = join(root, "chosen-project");
    await mkdir(projectPath);
    server = await startApp({ port: 0, stateDir: join(root, "state"), providers: [createFauxProvider()] });
    connection = await connect({ baseUrl: server.url, token: server.token, services: [Workspaces], reconnect: false });
    const workspaces = connection.services.use(Workspaces);
    await connection.services.ready(context);
    const listing = await workspaces.browse(root, context);
    expect(listing.directories).toContainEqual({ name: "chosen-project", path: projectPath });
    expect(workspaces.state.value?.workspaces).toEqual([]);
    await expect(workspaces.browse("relative", context)).rejects.toThrow("absolute path or null");
    const chosen = await workspaces.browse(projectPath, context);
    const id = await workspaces.add({ path: chosen.path }, context);
    expect(await workspaces.add({ path: chosen.path }, context)).toBe(id);
    expect(workspaces.state.value?.workspaces).toEqual([{ id, name: "chosen-project", path: projectPath }]);
  });
});
