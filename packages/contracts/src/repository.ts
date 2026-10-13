import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";

/** The pull request of a project's current branch, as `gh` reports it. */
export interface PullRequest {
  number: number;
  url: string;
}

export interface RepositoryState {
  /** By project id; a project whose branch has no pull request, or where `gh` is unavailable, is absent. */
  projects: Record<number, PullRequest>;
}

/**
 * The pull requests of the projects, read by the server with `gh pr view` in each project's directory. A page refreshes
 * the project it shows; a project whose branch has no pull request simply has no entry, so nothing is shown for it.
 */
export interface Repository {
  readonly state: ReplicatedState<RepositoryState>;
  /** Read the project's pull request again. Best-effort: a failure just leaves the project out. */
  refresh(workspaceId: number, context: Context): Promise<void>;
}

export const Repository = defineService<Repository>("tandem.repository");
