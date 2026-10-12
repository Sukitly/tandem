import { type Context, defineService } from "@earendil-works/chord";

/** Where a prompt template was found. */
export type PromptOrigin = "project" | "global";

/** A prompt template a client may offer as a slash command, without its body. */
export interface PromptTemplateSummary {
  /** The command name: the file's name without `.md`. */
  name: string;
  /** From the template's frontmatter, or else its first non-empty line. */
  description: string;
  /** From the template's frontmatter, as written, e.g. `"[focus]"`. */
  argumentHint?: string;
  /** A project template wins over a global one of the same name. */
  origin: PromptOrigin;
}

/**
 * The slash command templates of a project: the ones in the project's `.pi/prompts`, and the user's own in
 * `~/.pi/agent/prompts`. The list is read from disk, so it is a snapshot, not authoritative state.
 *
 * The templates are expanded on the server when a message is sent: a message that starts with `/name` becomes the
 * template's text, with the arguments substituted.
 */
export interface Prompts {
  /** The project's templates, project first by name. Empty when it has none and the user has none. */
  list(workspaceId: number, context: Context): Promise<PromptTemplateSummary[]>;
}

export const Prompts = defineService<Prompts>("tandem.prompts");
