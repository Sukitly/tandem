import { type Context, type MutableReplicatedState, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { PullRequest, RepositoryState } from "@tandem/contracts";
import { invalidInput } from "./errors.ts";
import type { ProjectPaths } from "./project-path.ts";
import type { WorkspaceCatalog } from "./workspaces.ts";

/** How long `gh` may take before the read is given up on. */
const GH_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 16_384;

/**
 * The projects' pull requests, read by running `gh pr view` in each project's directory, through the environment its
 * agents use. A read is best-effort: a project whose branch has no pull request, or where `gh` is missing or fails,
 * simply has no entry, and the page shows nothing for it.
 */
export class RepositoryBoard {
  readonly #state: MutableReplicatedState<RepositoryState>;
  readonly #paths: Pick<ProjectPaths, "resolve">;
  readonly #refreshes = new Map<number, Promise<void>>();

  readonly #workspaces: Pick<WorkspaceCatalog, "get">;

  constructor(paths: Pick<ProjectPaths, "resolve">, workspaces: Pick<WorkspaceCatalog, "get">) {
    this.#paths = paths;
    this.#workspaces = workspaces;
    this.#state = replicatedState<RepositoryState>({ projects: {} });
  }

  get state(): MutableReplicatedState<RepositoryState> {
    return this.#state;
  }

  /** Read the project's pull request again; concurrent reads of one project share a single run of `gh`. */
  async refresh(workspaceId: number, _context: Context): Promise<void> {
    if (!Number.isSafeInteger(workspaceId)) throw invalidInput("Project ID must be an integer");
    if (this.#workspaces.get(workspaceId) === undefined) throw invalidInput(`Project ${workspaceId} does not exist`);
    const running = this.#refreshes.get(workspaceId);
    if (running !== undefined) return running;
    const refresh = this.#read(workspaceId, BACKGROUND_CONTEXT).finally(() => this.#refreshes.delete(workspaceId));
    this.#refreshes.set(workspaceId, refresh);
    await refresh;
  }

  async #read(workspaceId: number, context: Context): Promise<void> {
    let pull: PullRequest | undefined;
    try {
      const { env, target } = await this.#paths.resolve({ workspaceId, path: "" }, context);
      let stdout = "";
      let bytes = 0;
      let truncated = false;
      const result = await env.exec(
        ["gh", "pr", "view", "--json", "number,url"],
        {
          cwd: target,
          timeout: GH_TIMEOUT_MS,
          onOutput: (text, _context, info) => {
            if (info.stream !== "stdout" || truncated) return;
            bytes += Buffer.byteLength(text);
            if (bytes > MAX_OUTPUT_BYTES) {
              truncated = true;
              stdout = "";
              return;
            }
            stdout += text;
          },
        },
        context,
      );
      if (!truncated && result.ok && result.value.exitCode === 0) pull = parsePullRequest(stdout);
    } catch {
      // Best-effort: a project that cannot be read simply has no pull request to show.
    }
    this.#publish(workspaceId, pull);
  }

  #publish(workspaceId: number, pull: PullRequest | undefined): void {
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      if (pull === undefined) delete draft.projects[workspaceId];
      else draft.projects[workspaceId] = pull;
    });
  }
}

/** `gh pr view --json number,url` output, or nothing when it names no pull request. */
export function parsePullRequest(stdout: string): PullRequest | undefined {
  try {
    const data = JSON.parse(stdout) as { number?: unknown; url?: unknown };
    if (typeof data.number !== "number" || !Number.isSafeInteger(data.number) || data.number <= 0) return undefined;
    if (typeof data.url !== "string") return undefined;
    const url = new URL(data.url);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return undefined;
    return { number: data.number, url: data.url };
  } catch {
    // Not JSON: no pull request to show.
  }
  return undefined;
}
