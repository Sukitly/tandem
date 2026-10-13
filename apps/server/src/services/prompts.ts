import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import type { PromptOrigin, PromptTemplateSummary } from "@tandem/contracts";
import type { ProjectPaths } from "./project-path.ts";
import { expandPromptTemplate, type PromptTemplate, parsePromptTemplate } from "./prompt-templates.ts";

/** A project's templates are read from disk; within this long, the same ones are served again. */
const CACHE_TTL_MS = 1000;

/** Where a project keeps its templates, from its directory. */
const PROJECT_PROMPTS_DIR = [".pi", "prompts"] as const;

export interface PromptLibraryOptions {
  paths: ProjectPaths;
  /** The environment the user's templates are read through: they are outside every project. */
  globalEnv: ExecutionEnv;
  /** The user's own templates, usually `~/.pi/agent/prompts`. */
  globalDir: string;
  now?: () => number;
}

/**
 * A project's prompt templates: the ones in the project's `.pi/prompts` and the user's own in `~/.pi/agent/prompts`.
 * The project's are read through its execution environment, as its files are; the user's through one of their own, since
 * they lie outside every project. A project template wins over a global one of the same name.
 */
export class PromptLibrary {
  readonly #paths: ProjectPaths;
  readonly #globalEnv: ExecutionEnv;
  readonly #globalDir: string;
  readonly #now: () => number;
  readonly #cache = new Map<number, { at: number; templates: PromptTemplate[] }>();

  constructor({ paths, globalEnv, globalDir, now = Date.now }: PromptLibraryOptions) {
    this.#paths = paths;
    this.#globalEnv = globalEnv;
    this.#globalDir = globalDir;
    this.#now = now;
  }

  async list(workspaceId: number, context: Context): Promise<PromptTemplateSummary[]> {
    const templates = await this.#templates(workspaceId, context);
    return templates.map(({ name, description, argumentHint, origin }) => ({
      name,
      description,
      ...(argumentHint === undefined ? {} : { argumentHint }),
      origin,
    }));
  }

  /**
   * Expand a message that names a template: `/review focus` becomes the template's text with its arguments. A message
   * that names no template, or does not start with a slash, is returned as it is.
   */
  async expand(workspaceId: number, text: string, context: Context): Promise<string> {
    if (!text.startsWith("/")) return text;
    return expandPromptTemplate(text, await this.#templates(workspaceId, context));
  }

  async #templates(workspaceId: number, context: Context): Promise<PromptTemplate[]> {
    const cached = this.#cache.get(workspaceId);
    const now = this.#now();
    if (cached !== undefined && now - cached.at < CACHE_TTL_MS) return cached.templates;
    const templates = await this.#load(workspaceId, context);
    this.#cache.set(workspaceId, { at: now, templates });
    return templates;
  }

  async #load(workspaceId: number, context: Context): Promise<PromptTemplate[]> {
    const { env, target } = await this.#paths.resolve({ workspaceId, path: "" }, context);
    const [global, project] = await Promise.all([
      this.#readDir(this.#globalEnv, this.#globalDir, "global", context),
      this.#readDir(env, join(target, ...PROJECT_PROMPTS_DIR), "project", context),
    ]);
    const byName = new Map<string, PromptTemplate>();
    for (const template of global) byName.set(template.name, template);
    for (const template of project) byName.set(template.name, template);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A directory's direct `.md` children. A directory that is not there, or cannot be read, has none. */
  async #readDir(env: ExecutionEnv, dir: string, origin: PromptOrigin, context: Context): Promise<PromptTemplate[]> {
    const listing = await env.listDir(dir, context);
    if (!listing.ok) return [];
    const templates: PromptTemplate[] = [];
    for (const entry of listing.value) {
      // Hidden files are left out, as are directories that merely end in `.md`; a symbolic link to a file is read.
      if (entry.kind === "directory" || entry.name.startsWith(".") || !entry.name.endsWith(".md")) continue;
      const file = await env.readTextFile(join(dir, entry.name), context);
      if (!file.ok) continue;
      templates.push(parsePromptTemplate(entry.name, file.value, origin));
    }
    return templates;
  }
}
