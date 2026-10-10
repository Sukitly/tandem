import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { createToken } from "./auth.ts";

/** What clients must know to reconnect: kept across restarts so open pages reconnect on their own. */
export interface ServerIdentity {
  serverId: string;
  token: string;
}

/** The directory holding Tandem's data, locked by this process. */
export interface StateDir {
  readonly path: string;
  readonly databasePath: string;
  readonly identity: ServerIdentity;
  release(): Promise<void>;
}

/** `$TANDEM_HOME`, or `~/.tandem`. */
export function defaultStateDirPath(): string {
  return process.env.TANDEM_HOME ?? join(homedir(), ".tandem");
}

/**
 * Create the directory if needed and lock it: pi-durable allows one process per database. A lock left by a crashed
 * process goes stale after 10 s, so a restart right after a crash waits that long.
 */
export async function openStateDir(
  path: string = defaultStateDirPath(),
  options: { lockRetries?: number } = {},
): Promise<StateDir> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(path, {
      realpath: false,
      lockfilePath: join(path, "server.lock"),
      retries: { retries: options.lockRetries ?? 12, minTimeout: 1000, maxTimeout: 1000 },
    });
  } catch (error) {
    throw new Error(`Another Tandem server is using ${path}`, { cause: error });
  }
  try {
    const identity = await loadIdentity(join(path, "server.json"));
    return { path, databasePath: join(path, "app.sqlite"), identity, release };
  } catch (error) {
    await release();
    throw error;
  }
}

async function loadIdentity(file: string): Promise<ServerIdentity> {
  try {
    const stored = JSON.parse(await readFile(file, "utf8")) as Partial<ServerIdentity>;
    if (typeof stored.serverId === "string" && typeof stored.token === "string") {
      return { serverId: stored.serverId, token: stored.token };
    }
  } catch (error) {
    if (!isErrorCode(error, "ENOENT")) throw new Error(`Cannot read ${file}`, { cause: error });
  }
  const identity: ServerIdentity = { serverId: randomUUID(), token: createToken() };
  await writeFile(file, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  return identity;
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
