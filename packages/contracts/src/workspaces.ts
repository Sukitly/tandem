import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";

/** A local directory added as a project. Conversations belong to one and work in its directory. */
export interface WorkspaceSummary {
  id: number;
  /** Absolute path of the directory. */
  path: string;
  /** The directory's name. */
  name: string;
}

export interface WorkspacesState {
  /** In the order they were added. */
  workspaces: WorkspaceSummary[];
}

/** A directory on the server's machine, offered when choosing a new project. */
export interface ProjectDirectory {
  /** Absolute selected path, preserving symlinks so existing projects keep their identity. */
  path: string;
  /** Null at a filesystem root. */
  parent: string | null;
  directories: { name: string; path: string }[];
}

/** The projects shared by every client. */
export interface Workspaces {
  readonly state: ReplicatedState<WorkspacesState>;
  /** Browse directories before adding a project. Null opens the server's home directory. */
  browse(path: string | null, context: Context): Promise<ProjectDirectory>;
  /**
   * Add a directory: an absolute path, or one starting with `~`. Returns its ID. Adding a directory that is listed
   * already returns its ID; adding one that was removed brings it back with its conversations.
   */
  add(input: { path: string }, context: Context): Promise<number>;
  /** Take the project and its conversations off the list. Nothing is deleted. */
  remove(id: number, context: Context): Promise<void>;
}

export const Workspaces = defineService<Workspaces>("tandem.workspaces");
