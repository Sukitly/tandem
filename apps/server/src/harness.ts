import type { Context } from "@earendil-works/chord";
import type { Models } from "@earendil-works/pi-ai";
import { createRegistry, type EnvTarget, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { TandemPrompt } from "./prompt.ts";

export interface OpenedHarness {
  readonly harness: Harness;
  close(context: Context): Promise<void>;
}

export interface OpenHarnessOptions {
  databasePath: string;
  models: Models;
  onReport?: (error: unknown) => void;
}

/**
 * The app's one Harness, serving every conversation of every workspace. Each conversation's agent works in its own
 * `cwd`; the execution environment is chosen by that directory.
 */
export async function openHarness(options: OpenHarnessOptions, context: Context): Promise<OpenedHarness> {
  const envs = new ExecutionEnvs();
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(TandemPrompt);
  const harness = await Harness.open(
    await openNodeSqliteStorage(options.databasePath),
    {
      models: options.models,
      registry,
      env: envs.env,
      ...(options.onReport === undefined ? {} : { onReport: options.onReport }),
    },
    context,
  );
  return {
    harness,
    async close(closeContext) {
      // Closing writes no outcome: running work continues after the next start.
      await harness.close(closeContext);
      await envs.cleanup(closeContext);
    },
  };
}

/** One execution environment per directory, shared by every conversation working in it. */
class ExecutionEnvs {
  readonly #envs = new Map<string, NodeExecutionEnv>();

  readonly env = ({ cwd }: EnvTarget): NodeExecutionEnv | undefined => {
    if (cwd === undefined) return undefined;
    let env = this.#envs.get(cwd);
    if (env === undefined) {
      env = new NodeExecutionEnv({ cwd });
      this.#envs.set(cwd, env);
    }
    return env;
  };

  async cleanup(context: Context): Promise<void> {
    const envs = [...this.#envs.values()];
    this.#envs.clear();
    for (const env of envs) await env.cleanup(context);
  }
}
