import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

/** Read a JSON file; `undefined` when it does not exist. */
export async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Cannot read ${path}`, { cause: error });
  }
}

/** Replace a JSON file atomically, readable by its owner only. */
export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

/** Runs operations one at a time, in call order. */
export class SerialQueue {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => {});
    return result;
  }
}
