import type { Comments, Files } from "@tandem/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { ProjectComments } from "@/comments/project-comments.ts";
import { ProjectFiles } from "@/files/project-files.ts";
import { createQueryClient } from "./query-client.tsx";

/** Connection-owned resource registry. Cache lifetime is independent of responsive layout and selected tabs. */
export class ProjectResources {
  readonly #files: Files;
  readonly #comments: Comments;
  readonly #client: QueryClient;
  readonly #projects = new Map<number, { files: ProjectFiles; comments: ProjectComments }>();

  constructor(files: Files, comments: Comments, client = createQueryClient()) {
    this.#files = files;
    this.#comments = comments;
    this.#client = client;
  }

  get(id: number) {
    let project = this.#projects.get(id);
    if (project === undefined) {
      project = {
        files: new ProjectFiles(this.#files, id, this.#client),
        comments: new ProjectComments(this.#comments, id),
      };
      this.#projects.set(id, project);
    }
    return project;
  }

  retain(ids: readonly number[]): void {
    const existing = new Set(ids);
    for (const [id, project] of this.#projects) {
      if (existing.has(id)) continue;
      project.files.dispose();
      this.#projects.delete(id);
    }
  }

  dispose(): void {
    for (const project of this.#projects.values()) project.files.dispose();
    this.#projects.clear();
  }
}
