import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { readJsonFile, SerialQueue, writeJsonFile } from "./json-file.ts";

type Stored = Record<string, Credential>;

/**
 * Model credentials in one JSON file (`auth.json` in the state directory), readable by its owner only. Writes are
 * serialized in this process; the state directory lock keeps other servers out.
 *
 * Tandem keeps its own credentials rather than sharing pi's: OAuth refresh tokens rotate, so two programs using one
 * token would sign each other out.
 */
export class FileCredentialStore implements CredentialStore {
  readonly #path: string;
  readonly #queue = new SerialQueue();

  constructor(path: string) {
    this.#path = path;
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    return (await this.#load())[providerId];
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    return Object.entries(await this.#load()).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.#queue.run(async () => {
      options?.signal?.throwIfAborted();
      const stored = await this.#load();
      const current = stored[providerId];
      const next = await fn(current);
      if (next === undefined) return current;
      await writeJsonFile(this.#path, { ...stored, [providerId]: next });
      return next;
    });
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.#queue.run(async () => {
      options?.signal?.throwIfAborted();
      const { [providerId]: _removed, ...rest } = await this.#load();
      await writeJsonFile(this.#path, rest);
    });
  }

  async #load(): Promise<Stored> {
    const value = await readJsonFile(this.#path);
    return value !== null && typeof value === "object" ? (value as Stored) : {};
  }
}
