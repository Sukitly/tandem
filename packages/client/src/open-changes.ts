import { Changes, ProjectChanges } from "@tandem/contracts";
import type { TandemConnection } from "./connect.ts";
import { firstValue, OpenInstances } from "./open-instances.ts";

/**
 * The projects whose changes a client shows, opened on its connection. A project is watched on the server while
 * anything holds it, and opened again after a reconnect.
 */
export class OpenChanges {
  readonly #instances: OpenInstances<number, ProjectChanges>;

  constructor(connection: TandemConnection, onError: (error: Error) => void = () => {}) {
    const changes = connection.services.use(Changes);
    this.#instances = new OpenInstances(
      connection,
      {
        service: ProjectChanges,
        open: (workspaceId, context) => changes.open(workspaceId, context),
        close: (workspaceId, context) => changes.close(workspaceId, context),
        keyOf: async (instance, context) => (await firstValue(instance.state, context))?.workspaceId,
      },
      onError,
    );
  }

  /** The instance of an open project, once it has arrived. */
  get(workspaceId: number): ProjectChanges | undefined {
    return this.#instances.get(workspaceId);
  }

  /** Why a project's changes are not there, if opening them failed. */
  failure(workspaceId: number): string | null {
    return this.#instances.failure(workspaceId)?.message ?? null;
  }

  /** Keep a project's changes open until the returned function is called. */
  hold(workspaceId: number): () => void {
    return this.#instances.hold(workspaceId);
  }

  /** Called when an instance arrives or leaves. */
  subscribe(listener: () => void): () => void {
    return this.#instances.subscribe(listener);
  }

  dispose(): void {
    this.#instances.dispose();
  }
}
