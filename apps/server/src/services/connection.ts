import { type Context, RemoteServiceProvider } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import {
  Changes,
  Conversation,
  Conversations,
  Files,
  Models,
  ProjectChanges,
  type StartInput,
  Workspaces,
} from "@tandem/contracts";
import type { ConnectionServices } from "../rpc-host.ts";
import { createProjectChanges, type ProjectChangeTracker } from "./changes.ts";
import {
  createConversationService,
  initialAgent,
  type NoticeBoard,
  parseSubmitInput,
  submitMessage,
} from "./conversation.ts";
import type { ConversationCatalog } from "./conversations.ts";
import { invalidInput } from "./errors.ts";
import type { FileBrowser } from "./files.ts";
import type { ModelCatalog } from "./models.ts";
import type { WorkspaceCatalog } from "./workspaces.ts";

export interface AppServices {
  readonly harness: Harness;
  /** Reads a project's changes against its integration branch, and watches them while a client holds it open. */
  readonly openTracker: (workspaceId: number, context: Context) => Promise<ProjectChangeTracker>;
  readonly catalog: ConversationCatalog;
  readonly workspaces: WorkspaceCatalog;
  readonly files: FileBrowser;
  readonly models: ModelCatalog;
  readonly notices: NoticeBoard;
}

/** An open conversation on one connection. */
interface OpenConversation {
  close(): void;
}

/** A project whose changes one connection follows, or is still starting to follow. */
interface Watching {
  opening: Promise<ProjectChangeTracker>;
  /** Set once the instance reaches the client. */
  withdraw?: () => void;
  /** The client let it go, or the connection ended. */
  closed: boolean;
}

/** The services of one client connection: the shared lists, and the conversations it opened. */
export function createConnectionServices({
  harness,
  catalog,
  workspaces,
  files,
  models,
  notices,
  openTracker,
}: AppServices): ConnectionServices {
  const provider = new RemoteServiceProvider([
    Models,
    Workspaces,
    Files,
    Changes,
    Conversations,
    { service: Conversation, mode: "keyed" },
    { service: ProjectChanges, mode: "keyed" },
  ]);
  const opened = new Map<number, Promise<OpenConversation>>();
  const watching = new Map<number, Watching>();
  let disposed = false;

  // Instances are long-lived, so they are not tied to the context of the call that opened them.
  const openConversation = async (id: number): Promise<OpenConversation> => {
    const conversation = await harness.conversation(id as ConversationId, BACKGROUND_CONTEXT);
    if (conversation === undefined) throw new Error(`Conversation ${id} does not exist`);
    const view = await conversation.viewState(BACKGROUND_CONTEXT);
    try {
      if (disposed) throw new Error("Connection is closed");
      const withdraw = provider.spawn(
        Conversation,
        String(id),
        createConversationService({
          conversation,
          view,
          notices,
          models,
          onSubmitted: (_text, context) => catalog.noteMessage(id, context),
        }),
      );
      return {
        close() {
          withdraw();
          view.dispose();
        },
      };
    } catch (error) {
      view.dispose();
      throw error;
    }
  };

  provider.provide(Models, {
    state: models.state,
    async login(input) {
      const { providerId, type } = (input ?? {}) as { providerId?: unknown; type?: unknown };
      if (typeof providerId !== "string") throw invalidInput("providerId must be a string");
      if (type !== "oauth" && type !== "api_key") throw invalidInput('type must be "oauth" or "api_key"');
      return models.login(providerId, type);
    },
    async answerLogin(input) {
      const { promptId, value } = (input ?? {}) as { promptId?: unknown; value?: unknown };
      if (typeof promptId !== "number" || typeof value !== "string") throw invalidInput("Invalid answer");
      models.answerLogin(promptId, value);
    },
    async cancelLogin() {
      models.cancelLogin();
    },
    async logout(providerId) {
      if (typeof providerId !== "string") throw invalidInput("providerId must be a string");
      await models.logout(providerId);
    },
    async setDefaultModel(model) {
      const { provider: providerId, modelId } = (model ?? {}) as { provider?: unknown; modelId?: unknown };
      if (typeof providerId !== "string" || typeof modelId !== "string") throw invalidInput("Invalid model");
      await models.setDefaultModel({ provider: providerId, modelId });
    },
  });

  provider.provide(Workspaces, {
    state: workspaces.state,
    async add(input, context) {
      const { path } = (input ?? {}) as { path?: unknown };
      if (typeof path !== "string") throw invalidInput("path must be a string");
      return workspaces.add(path, context);
    },
    async remove(id, context) {
      parseId(id, "Project");
      await workspaces.remove(id, context);
    },
  });

  // The tracker is long-lived, so it is not tied to the context of the call that opened it.
  const openChanges = async (workspaceId: number, context: Context): Promise<void> => {
    if (watching.has(workspaceId)) return;
    const opening = openTracker(workspaceId, context);
    const entry: Watching = { opening, closed: false };
    watching.set(workspaceId, entry);
    opening.catch(() => {
      if (watching.get(workspaceId) === entry) watching.delete(workspaceId);
    });
    const tracker = await opening;
    // Closed while this was opening: the instance never reaches the client, and the tracker goes away with it.
    if (entry.closed || disposed) tracker.dispose();
    else entry.withdraw = provider.spawn(ProjectChanges, String(workspaceId), createProjectChanges(tracker));
  };

  provider.provide(Changes, {
    async open(workspaceId, context) {
      parseId(workspaceId, "Project");
      await openChanges(workspaceId, context);
    },
    async close(workspaceId) {
      parseId(workspaceId, "Project");
      const entry = watching.get(workspaceId);
      if (entry === undefined) return;
      watching.delete(workspaceId);
      entry.closed = true;
      const tracker = await entry.opening.catch(() => undefined);
      entry.withdraw?.();
      tracker?.dispose();
    },
  });

  provider.provide(Files, {
    list: (location, context) => files.list(location, context),
    read: (location, context) => files.read(location, context),
  });

  provider.provide(Conversations, {
    state: catalog.state,
    async start(input, context) {
      const { workspaceId, model, thinkingLevel } = (input ?? {}) as { [K in keyof StartInput]?: unknown };
      parseId(workspaceId, "Project");
      const { text } = parseSubmitInput({ ...(input ?? {}), whenBusy: "followUp" });
      const conversation = await catalog.create(
        workspaceId,
        text,
        initialAgent(models, { model, thinkingLevel }),
        context,
      );
      await submitMessage(conversation, notices, { text, whenBusy: "followUp" }, context);
      return conversation.id as number;
    },
    async open(id) {
      parseId(id);
      if (!catalog.has(id)) throw invalidInput(`Conversation ${id} does not exist`);
      let opening = opened.get(id);
      if (opening === undefined) {
        opening = openConversation(id);
        opened.set(id, opening);
        opening.catch(() => {
          if (opened.get(id) === opening) opened.delete(id);
        });
      }
      await opening;
    },
    async close(id) {
      parseId(id);
      const opening = opened.get(id);
      if (opening === undefined) return;
      opened.delete(id);
      (await opening.catch(() => undefined))?.close();
    },
  });

  return {
    provider,
    dispose() {
      disposed = true;
      for (const entry of watching.values()) {
        entry.closed = true;
        entry.withdraw?.();
        void entry.opening.then(
          (tracker) => tracker.dispose(),
          () => {},
        );
      }
      watching.clear();
      for (const opening of opened.values())
        void opening.then(
          (conversation) => conversation.close(),
          () => {},
        );
      opened.clear();
    },
  };
}

function parseId(id: unknown, what = "Conversation"): asserts id is number {
  if (!Number.isSafeInteger(id) || (id as number) < 0) throw invalidInput(`${what} ID must be a non-negative integer`);
}
