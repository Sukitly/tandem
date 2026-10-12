import type { Context } from "@earendil-works/chord";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { type FileContent, type FileEntry, type FileLocation, MAX_FILE_VIEW_BYTES } from "@tandem/contracts";
import { type ProjectPaths, unwrap } from "./project-path.ts";

/** How much of a file Git looks at to tell binary from text: a NUL byte there makes it binary. */
const BINARY_SNIFF_BYTES = 8000;

/**
 * Reads the projects' files through their execution environments, the ones their agents use. A path is taken from the
 * project's directory, and resolved with its symbolic links; what it names must be inside that directory.
 */
export class FileBrowser {
  readonly #paths: ProjectPaths;

  constructor(paths: ProjectPaths) {
    this.#paths = paths;
  }

  async list(location: FileLocation, context: Context): Promise<FileEntry[]> {
    const { env, path, target, workspace } = await this.#paths.resolve(location, context);
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
    const { env, path, target } = await this.#paths.resolve(location, context);
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
}
