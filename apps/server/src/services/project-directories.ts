import { homedir } from "node:os";
import { dirname, isAbsolute } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import type { ProjectDirectory } from "@tandem/contracts";
import { invalidInput } from "./errors.ts";
import { unwrap } from "./project-path.ts";

/** Browses the server's directories through its execution environment before a project exists. */
export class ProjectDirectoryBrowser {
  readonly #env: ExecutionEnv;

  constructor(env: ExecutionEnv) {
    this.#env = env;
  }

  async browse(input: unknown, context: Context): Promise<ProjectDirectory> {
    if (input !== null && (typeof input !== "string" || !isAbsolute(input) || input.includes("\0"))) {
      throw invalidInput("path must be an absolute path or null");
    }
    const env = this.#env;
    // Preserve the selected spelling: project identity uses its absolute path, not its symlink target.
    const path = unwrap(await env.absolutePath(input === null ? homedir() : input, context), String(input));
    const entries = unwrap(await env.listDir(path, context), path);
    const directories = await Promise.all(
      entries.map(async (entry) => {
        if (entry.kind === "directory") return { name: entry.name, path: entry.path };
        if (entry.kind !== "symlink") return null;
        const target = await env.canonicalPath(entry.path, context);
        if (!target.ok) return null;
        const info = await env.fileInfo(target.value, context);
        return info.ok && info.value.kind === "directory" ? { name: entry.name, path: entry.path } : null;
      }),
    );
    const parent = dirname(path);
    return {
      path,
      parent: parent === path ? null : parent,
      directories: directories
        .filter((entry) => entry !== null)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    };
  }
}
