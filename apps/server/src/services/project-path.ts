import type { Context } from "@earendil-works/chord";
import type { ExecutionEnv, FileError, Result } from "@earendil-works/pi-durable/env";
import type { FileLocation, WorkspaceSummary } from "@tandem/contracts";
import { invalidInput } from "./errors.ts";
import type { WorkspaceCatalog } from "./workspaces.ts";

/** A path inside a project, resolved. */
export interface ProjectLocation {
  /** The environment of the project's directory, the one its agents use. */
  env: ExecutionEnv;
  workspace: WorkspaceSummary;
  /** From the project's directory, separated by `/`; `""` is the directory itself. */
  path: string;
  /** What `path` names, with its symbolic links resolved. */
  target: string;
}

/**
 * Turns a path a client sent into one the file system can be asked about: taken from the named project's directory,
 * inside it also through symbolic links.
 */
export class ProjectPaths {
  readonly #workspaces: WorkspaceCatalog;
  readonly #env: (cwd: string) => ExecutionEnv;

  constructor(workspaces: WorkspaceCatalog, env: (cwd: string) => ExecutionEnv) {
    this.#workspaces = workspaces;
    this.#env = env;
  }

  async resolve(location: FileLocation, context: Context): Promise<ProjectLocation> {
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
    return { env, workspace, path, target };
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

export function unwrap<T>(result: Result<T, FileError>, path: string): T {
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
