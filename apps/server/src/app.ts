import { homedir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Provider } from "@earendil-works/pi-ai";
import { commentTools } from "./comment-tool.ts";
import { storedImage } from "./conversation-view.ts";
import { FileCredentialStore } from "./credentials.ts";
import { DeviceSessions } from "./device-sessions.ts";
import { openHarness } from "./harness.ts";
import { createNodePhotonImages } from "./images/node.ts";
import { createAppModels, defaultProviders } from "./models.ts";
import { type StartServerOptions, startServer, type TandemServer } from "./server.ts";
import { ChangeTrackers } from "./services/changes.ts";
import { CommentBoard } from "./services/comments.ts";
import { createConnectionServices } from "./services/connection.ts";
import { NoticeBoard } from "./services/conversation.ts";
import { ConversationCatalog } from "./services/conversations.ts";
import { FileBrowser } from "./services/files.ts";
import { ModelCatalog } from "./services/models.ts";
import { ProjectDirectoryBrowser } from "./services/project-directories.ts";
import { ProjectPaths } from "./services/project-path.ts";
import { PromptLibrary } from "./services/prompts.ts";
import { TerminalHost } from "./services/terminals.ts";
import { WorkspaceCatalog } from "./services/workspaces.ts";
import { Settings } from "./settings.ts";
import { openStateDir } from "./state-dir.ts";

export interface StartAppOptions
  extends Pick<StartServerOptions, "hostname" | "port" | "allowedOrigins" | "publicUrl" | "webRoot"> {
  /** Default: `$TANDEM_HOME`, or `~/.tandem`. */
  stateDir?: string;
  /** Model providers. Default: every provider pi-ai ships. Tests pass the faux provider only. */
  providers?: readonly Provider[];
  onError?: (error: Error) => void;
  /** The program a terminal runs, for tests; the user's login shell by default. */
  terminalCommand?: readonly string[];
  /** Where the user's prompt templates are read; `~/.pi/agent/prompts` by default, shared with pi itself. */
  globalPromptsDir?: string;
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
    const settings = await Settings.load(join(stateDir.path, "settings.json"));
    const devices = await DeviceSessions.load(join(stateDir.path, "devices.json"));
    cleanups.push(() => devices.flush());
    const publicUrl = options.publicUrl ?? settings.value.publicUrl;
    const credentials = new FileCredentialStore(join(stateDir.path, "auth.json"));
    const models = createAppModels(credentials, options.providers ?? defaultProviders());
    const modelCatalog = await ModelCatalog.load(models, credentials, settings);
    // Images are fitted in a worker thread, which starts with the first image and exits when idle.
    const images = await createNodePhotonImages();
    const opened = await openHarness(
      { databasePath: stateDir.databasePath, models, images, onReport: (error) => onError(toError(error)) },
      context,
    );
    cleanups.push(() => opened.close(context));
    const notices = new NoticeBoard();
    const workspaces = await WorkspaceCatalog.load(opened.harness, context);
    const catalog = await ConversationCatalog.load(opened.harness, workspaces, context);
    cleanups.push(async () => catalog.dispose());
    const comments = await CommentBoard.load(opened.harness, workspaces, context, { onError });
    cleanups.push(async () => comments.dispose());
    // Installed before any work resumes, so a conversation that continues after a restart has the tool too.
    opened.registry.install(commentTools(comments, catalog));
    const paths = new ProjectPaths(workspaces, opened.env);
    const changes = new ChangeTrackers(paths, onError);
    cleanups.push(() => changes.dispose());
    const files = new FileBrowser(paths);
    const directories = new ProjectDirectoryBrowser(opened.env(homedir()));
    const globalPromptsDir = options.globalPromptsDir ?? join(agentDir(), "prompts");
    const prompts = new PromptLibrary({
      paths,
      globalEnv: opened.env(globalPromptsDir),
      globalDir: globalPromptsDir,
    });
    const terminals = new TerminalHost(
      workspaces,
      paths,
      options.terminalCommand === undefined ? {} : { command: options.terminalCommand },
    );
    cleanups.push(async () => terminals.dispose());

    const server = await startServer({
      ...pick(options, ["hostname", "port", "allowedOrigins", "webRoot"]),
      publicUrl,
      devices,
      ...stateDir.identity,
      createConnectionServices: () =>
        createConnectionServices({
          harness: opened.harness,
          catalog,
          workspaces,
          files,
          directories,
          models: modelCatalog,
          notices,
          changes,
          comments,
          prompts,
          terminals,
          images,
          devices,
          publicUrl,
        }),
      terminal: (id) => terminals.get(id),
      image: (ref) => storedImage(opened.harness, ref, context),
      onError,
    });
    cleanups.push(() => server.stop());
    // Work interrupted by the last shutdown continues now.
    opened.harness.resume();

    return {
      url: server.url,
      serverId: server.serverId,
      token: server.token,
      publicUrl: server.publicUrl,
      pair: server.pair,
      stop: cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** pi's own agent directory: `PI_CODING_AGENT_DIR` when set, so both tools can be pointed at one, and `~/.pi/agent` otherwise. */
function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Partial<Pick<T, K>> {
  return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])) as Partial<
    Pick<T, K>
  >;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
