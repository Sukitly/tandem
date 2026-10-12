import type { Context } from "@earendil-works/chord";
import type { ExecutionEnv, FileError, Result } from "@earendil-works/pi-durable/env";
import {
  type FileContent,
  type FileEntry,
  type FileLocation,
  MAX_FILE_VIEW_BYTES,
  type WorkspaceSummary,
} from "@tandem/contracts";
import { invalidInput } from "./errors.ts";
import type { WorkspaceCatalog } from "./workspaces.ts";

/** How much of a file Git looks at to tell binary from text: a NUL byte there makes it binary. */
const BINARY_SNIFF_BYTES = 8000;

/**
 * Reads the projects' files through their execution environments, the ones their agents use. A path is taken from the
 * project's directory, and resolved with its symbolic links; what it names must be inside that directory.
 */
export class FileBrowser {
  readonly #workspaces: WorkspaceCatalog;
  readonly #env: (cwd: string) => ExecutionEnv;

  constructor(workspaces: WorkspaceCatalog, env: (cwd: string) => ExecutionEnv) {
    this.#workspaces = workspaces;
    this.#env = env;
  }

  async list(location: FileLocation, context: Context): Promise<FileEntry[]> {
    const { env, path, target, workspace } = await this.#resolve(location, context);
    const infos = unwrap(await env.listDir(target, context), path);
    const entries = await Promise.all(
      infos.map(async (info): Promise<FileEntry> => {
        const entry = { name: info.name, path: path === "" ? info.name : `${path}/${info.name}` };
        if (info.kind === "directory") return { ...entry, kind: "directory" };
        if (info.kind === "file") return { ...entry, kind: "file", size: info.size };
        // `canonicalPath` follows the link; `fileInfo` does not, so it is asked about the target.
        const resolved = await env.canonicalPath(info.path, context);
        const pointee = resolved.ok ? await env.fileInfo(resolved.value, context) : undefined;
        if (pointee?.ok !== true) return { ...entry, kind: "file", symlink: true };
        return pointee.value.kind === "directory"
          ? { ...entry, kind: "directory", symlink: true }
          : { ...entry, kind: "file", symlink: true, size: pointee.value.size };
      }),
    );
    const ignored = await this.#ignored(env, workspace.path, path, context);
    return entries
      .map((entry) => (ignored.has(entry.path) ? { ...entry, ignored: true as const } : entry))
      .sort(
        (a, b) =>
          Number(b.kind === "directory") - Number(a.kind === "directory") ||
          a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
  }

  /**
   * The entries of a directory Git ignores, of the given ones. Ignored directories are reported as themselves, not as
   * everything below them, so an ignored directory's contents are known by their parent being ignored.
   */
  async #ignored(env: ExecutionEnv, project: string, path: string, context: Context): Promise<ReadonlySet<string>> {
    const ignored = new Set<string>();
    let output = "";
    const result = await env.exec(
      [
        "git",
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
        "-z",
        "--",
        path === "" ? "." : path,
      ],
      { cwd: project, onOutput: (text) => (output += text) },
      context,
    );
    // A directory that is not in a repository, or one with nothing ignored, both leave nothing to mark.
    if (!result.ok || result.value.exitCode !== 0) return ignored;
    for (const entry of output.split("\0")) {
      if (entry === "") continue;
      ignored.add(entry.endsWith("/") ? entry.slice(0, -1) : entry);
    }
    return ignored;
  }

  async read(location: FileLocation, context: Context): Promise<FileContent> {
    const { env, path, target } = await this.#resolve(location, context);
    const reader = unwrap(await env.openBinaryReader(target, undefined, context), path);
    try {
      const { size } = unwrap(await reader.info(context), path);
      if (size > MAX_FILE_VIEW_BYTES) return { kind: "tooLarge", size };
      const bytes = unwrap(await reader.read(0, size, context), path);
      if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { kind: "binary", size };
      return { kind: "text", text: new TextDecoder().decode(bytes), size };
    } finally {
      await reader.close(context);
    }
  }

  async #resolve(
    location: FileLocation,
    context: Context,
  ): Promise<{ env: ExecutionEnv; path: string; target: string; workspace: WorkspaceSummary }> {
    const { workspaceId, path: input } = (location ?? {}) as { workspaceId?: unknown; path?: unknown };
    if (!Number.isSafeInteger(workspaceId)) throw invalidInput("Project ID must be an integer");
    const workspace = this.#workspaces.get(workspaceId as number);
    if (workspace === undefined) throw invalidInput(`Project ${workspaceId} does not exist`);
    const path = relativePath(input);
    const env = this.#env(workspace.path);
    const root = unwrap(await env.canonicalPath(workspace.path, context), "");
    const inside = root.endsWith("/") ? root : `${root}/`;
    const target = unwrap(await env.canonicalPath(path === "" ? root : `${inside}${path}`, context), path);
    if (target !== root && !target.startsWith(inside)) throw invalidInput(`${path} is outside the project`);
    return { env, path, target, workspace };
  }
}

/** A path from the project's directory, without `.` segments or a trailing `/`. `..` is refused. */
function relativePath(input: unknown): string {
  if (typeof input !== "string") throw invalidInput("path must be a string");
  if (input.startsWith("/") || input.includes("\0")) throw invalidInput("path must be relative to the project");
  const segments = input.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) throw invalidInput(`${input} is outside the project`);
  return segments.join("/");
}

function unwrap<T>(result: Result<T, FileError>, path: string): T {
  if (result.ok) return result.value;
  const where = path === "" ? "the project's directory" : path;
  switch (result.error.code) {
    case "not_found":
      throw invalidInput(`${where} does not exist`);
    case "permission_denied":
      throw invalidInput(`Permission denied: ${where}`);
    case "not_directory":
      throw invalidInput(`${where} is not a directory`);
    case "is_directory":
      throw invalidInput(`${where} is a directory`);
    case "invalid":
      throw invalidInput(`${where} is not a regular file`);
    default:
      throw result.error;
  }
}
