import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openHarness } from "./harness.ts";
import { type AppModels, createFauxModels } from "./models.ts";
import { type StartServerOptions, startServer, type TandemServer } from "./server.ts";
import { createConnectionServices } from "./services/connection.ts";
import { ConversationCatalog } from "./services/conversations.ts";
import { openStateDir } from "./state-dir.ts";

export interface StartAppOptions extends Pick<StartServerOptions, "hostname" | "port" | "allowedOrigins"> {
  /** Default: `$TANDEM_HOME`, or `~/.tandem`. */
  stateDir?: string;
  /** Default: the faux model. */
  models?: AppModels;
  onError?: (error: Error) => void;
}

/** Open the state directory and the Harness, then serve them. `stop()` releases everything in reverse order. */
export async function startApp(options: StartAppOptions = {}): Promise<TandemServer> {
  const context = BACKGROUND_CONTEXT;
  const onError = options.onError ?? (() => {});
  const stateDir = await openStateDir(options.stateDir);
  const cleanups: (() => Promise<void>)[] = [() => stateDir.release()];
  const cleanup = async (): Promise<void> => {
    for (const step of cleanups.splice(0).reverse()) await step();
  };

  try {
    const { models, defaultModel } = options.models ?? createFauxModels();
    const opened = await openHarness(
      { databasePath: stateDir.databasePath, models, onReport: (error) => onError(toError(error)) },
      context,
    );
    cleanups.push(() => opened.close(context));
    const catalog = await ConversationCatalog.load(opened.harness, defaultModel, context);

    const server = await startServer({
      ...pick(options, ["hostname", "port", "allowedOrigins"]),
      ...stateDir.identity,
      createConnectionServices: () => createConnectionServices({ harness: opened.harness, catalog }),
      onError,
    });
    cleanups.push(() => server.stop());
    // Work interrupted by the last shutdown continues now.
    opened.harness.resume();

    return {
      url: server.url,
      serverId: server.serverId,
      token: server.token,
      stop: cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Partial<Pick<T, K>> {
  return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])) as Partial<
    Pick<T, K>
  >;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
