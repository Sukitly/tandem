import { type Context, RemoteServiceProvider } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import {
  Changes,
  Comments,
  Conversation,
  Conversations,
  Devices,
  Files,
  Models,
  ProjectChanges,
  Prompts,
  type StartInput,
  Terminals,
  Workspaces,
} from "@tandem/contracts";
import { pageView } from "../conversation-view.ts";
import { type DeviceSessions, PairingError } from "../device-sessions.ts";
import type { ImageProcessor } from "../images/image-processor.ts";
import type { ConnectionServices } from "../rpc-host.ts";
import { type ChangeHold, type ChangeTrackers, createProjectChanges } from "./changes.ts";
import type { CommentBoard } from "./comments.ts";
import {
  createConversationService,
  imagesFor,
  initialAgent,
  joinMessage,
  type NoticeBoard,
  parseSubmitInput,
  sendWithComments,
} from "./conversation.ts";
import type { ConversationCatalog } from "./conversations.ts";
import { invalidInput } from "./errors.ts";
import type { FileBrowser } from "./files.ts";
import type { ModelCatalog } from "./models.ts";
import type { ProjectDirectoryBrowser } from "./project-directories.ts";
import type { PromptLibrary } from "./prompts.ts";
import type { TerminalHost } from "./terminals.ts";
import type { WorkspaceCatalog } from "./workspaces.ts";

export interface AppServices {
  readonly devices: DeviceSessions;
  readonly publicUrl?: string;
  readonly harness: Harness;
  /** The projects' change trackers, shared by every connection: one tracker per project. */
  readonly changes: ChangeTrackers;
  readonly catalog: ConversationCatalog;
  readonly workspaces: WorkspaceCatalog;
  readonly files: FileBrowser;
  readonly directories: ProjectDirectoryBrowser;
  readonly models: ModelCatalog;
  readonly notices: NoticeBoard;
  readonly comments: CommentBoard;
  readonly prompts: PromptLibrary;
  readonly terminals: TerminalHost;
  /** Fits images to a model: those a page sends with a message. */
  readonly images: ImageProcessor;
}

/** An open conversation on one connection. */
interface OpenConversation {
  close(): void;
}

/** A project whose changes one connection follows, or is still starting to follow. */
interface Watching {
  opening: Promise<ChangeHold>;
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
  directories,
  models,
  notices,
  changes,
  comments,
  prompts,
  terminals,
  images,
  devices,
  publicUrl,
}: AppServices): ConnectionServices {
  const provider = new RemoteServiceProvider([
    Models,
    Workspaces,
    Files,
    Changes,
    Comments,
    Terminals,
    Devices,
    Prompts,
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
    const durable = await conversation.viewState(BACKGROUND_CONTEXT);
    // Pages fetch images on their own; the view they receive holds where, not the data.
    const view = pageView(durable);
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
          comments,
          images,
          prompts,
          workspaceId: () => catalog.workspaceOf(id),
          onSubmitted: (_text, context) => catalog.noteMessage(id, context),
        }),
      );
      return {
        close() {
          withdraw();
          view.dispose();
          durable.dispose();
        },
      };
    } catch (error) {
      view.dispose();
      durable.dispose();
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
    browse: (path, context) => directories.browse(path, context),
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
    const opening = changes.acquire(workspaceId, context);
    const entry: Watching = { opening, closed: false };
    watching.set(workspaceId, entry);
    opening.catch(() => {
      if (watching.get(workspaceId) === entry) watching.delete(workspaceId);
    });
    const hold = await opening;
    // Closed while this was opening: the instance never reaches the client, and this hold is given up with it.
    if (entry.closed || disposed) await hold.release();
    else entry.withdraw = provider.spawn(ProjectChanges, String(workspaceId), createProjectChanges(hold.tracker));
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
      const hold = await entry.opening.catch(() => undefined);
      entry.withdraw?.();
      await hold?.release();
    },
  });

  provider.provide(Comments, {
    state: comments.state,
    start: (input, context) => comments.start(input, context),
    reply: (input, context) => comments.reply(input, context),
    edit: (input, context) => comments.edit(input, context),
    withdraw: (input, context) => comments.withdraw(input, context),
    remove: (threadId, context) => comments.remove(threadId, context),
  });

  const deviceId = (id: unknown): string => {
    if (typeof id !== "string" || !devices.state.value.devices.some((device) => device.id === id))
      throw invalidInput("Device does not exist");
    return id;
  };
  provider.provide(Devices, {
    state: devices.state,
    addDevice: async () => {
      try {
        return devices.issue(publicUrl);
      } catch (error) {
        if (error instanceof PairingError) throw invalidInput(error.message);
        throw error;
      }
    },
    rename: async (id, name) => {
      const parsed = deviceId(id);
      if (typeof name !== "string" || name.trim().length === 0 || name.length > 80)
        throw invalidInput("Device name must contain 1 to 80 characters");
      await devices.rename(parsed, name.trim());
    },
    revoke: async (id) => devices.revoke(deviceId(id)),
    revokeOthers: async (id) => devices.revokeOthers(deviceId(id)),
    regenerateRecoveryCodes: async () => devices.regenerateRecoveryCodes(),
  });

  provider.provide(Terminals, {
    state: terminals.state,
    create: (input, context) => terminals.create(input, context),
    close: async (id) => terminals.close(id),
  });

  provider.provide(Files, {
    list: (location, context) => files.list(location, context),
    read: (location, context) => files.read(location, context),
  });

  provider.provide(Prompts, {
    list: (workspaceId, context) => {
      parseId(workspaceId, "Project");
      return prompts.list(workspaceId, context);
    },
  });

  provider.provide(Conversations, {
    state: catalog.state,
    async start(input, context) {
      const { workspaceId, model, thinkingLevel } = (input ?? {}) as { [K in keyof StartInput]?: unknown };
      parseId(workspaceId, "Project");
      const { text, comments: ids, images: sent } = parseSubmitInput({ ...(input ?? {}), whenBusy: "followUp" });
      const agent = initialAgent(models, { model, thinkingLevel });
      // Fitted before anything is created: a model that takes no images refuses the message, not half of it.
      const attached = await imagesFor(
        sent,
        agent.model === undefined ? undefined : models.available(agent.model),
        images,
      );
      // Expanded before the comments are taken, so a failure leaves them waiting.
      const expanded = await prompts.expand(workspaceId, text, context);
      const taken = comments.take(workspaceId, ids);
      const message = joinMessage(taken.text, expanded);
      let conversation: Awaited<ReturnType<ConversationCatalog["create"]>>;
      try {
        if (message === "" && attached.length === 0) throw invalidInput("Write a message, or a comment to send");
        // Titled after what the user typed; a conversation started by comments alone, after the first one's place.
        const anchor = taken.first?.anchor;
        const title = text.trim() !== "" || anchor === undefined ? text : `Review of ${anchor.path}:${anchor.line}`;
        const named = title.trim() !== "" ? title : message !== "" ? message : "Image";
        conversation = await catalog.create(workspaceId, named, agent, context);
      } catch (error) {
        taken.release();
        throw error;
      }
      await sendWithComments(
        conversation,
        notices,
        taken,
        { text: message, images: attached, whenBusy: "followUp" },
        context,
      );
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
          (hold) => hold.release(),
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
