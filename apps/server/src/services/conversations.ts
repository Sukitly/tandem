import { stat } from "node:fs/promises";
import {
  type AttachedReplicatedState,
  type Context,
  type MutableReplicatedState,
  replicatedState,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  type AgentChange,
  AgentDoc,
  type ConversationId,
  type Cursor,
  defineDoc,
  type Harness,
  type Conversation as HarnessConversation,
  type TaskGraph,
} from "@earendil-works/pi-durable";
import type { ConversationSummary, ConversationsState } from "@tandem/contracts";
import { invalidInput } from "./errors.ts";
import type { WorkspaceCatalog } from "./workspaces.ts";

/** What Tandem stores about a conversation besides pi's own documents. */
type ConversationMeta = {
  createdAt: number;
  /** Absent in conversations created before workspaces; `load()` fills it in. */
  workspaceId?: number;
  updatedAt?: number;
  /** From the first message. Conversations created before they started with a message may have none, and stay out. */
  title?: string;
};

/** Exported for tests, which write conversations as older versions did. */
export const ConversationMetaDoc = defineDoc<ConversationMeta>({
  kind: "tandem.conversation",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ createdAt: 0 }),
});

const TITLE_LENGTH = 80;

type Stored = Omit<ConversationSummary, "running">;

/**
 * The conversation list shared by every connection. It is the only writer of conversation metadata, so it updates the
 * list after each of its own commits instead of following the Harness's commits. It lists the conversations of listed
 * workspaces only, and follows the task graph to tell which ones are running.
 */
export class ConversationCatalog {
  readonly #harness: Harness;
  readonly #workspaces: WorkspaceCatalog;
  readonly #now: () => number;
  readonly #stored: Map<number, Stored>;
  readonly #state: MutableReplicatedState<ConversationsState>;
  readonly #stop: (() => void)[] = [];
  #running = new Set<number>();

  private constructor(harness: Harness, workspaces: WorkspaceCatalog, now: () => number, stored: Stored[]) {
    this.#harness = harness;
    this.#workspaces = workspaces;
    this.#now = now;
    this.#stored = new Map(stored.map((summary) => [summary.id, summary]));
    this.#state = replicatedState<ConversationsState>({ conversations: this.#list() });
    this.#stop.push(workspaces.subscribe(() => this.#publish()));
  }

  /** Lists the conversations users created. Conversations that tasks own, such as subagents', are not listed. */
  static async load(
    harness: Harness,
    workspaces: WorkspaceCatalog,
    context: Context,
    now: () => number = Date.now,
  ): Promise<ConversationCatalog> {
    const stored: Stored[] = [];
    let cursor: Cursor | undefined;
    do {
      const page = await harness.commit((tx) => tx.scanConversations({}, 256, cursor), context);
      for (const record of page.items) {
        if (record.owner !== undefined) continue;
        const summary = await readSummary(harness, workspaces, record.id, context);
        if (summary !== undefined) stored.push(summary);
      }
      cursor = page.next;
    } while (cursor !== undefined);
    const catalog = new ConversationCatalog(harness, workspaces, now, stored);
    await catalog.#followTasks(context);
    return catalog;
  }

  get state(): MutableReplicatedState<ConversationsState> {
    return this.#state;
  }

  /** The conversation is listed. */
  has(id: number): boolean {
    return this.#state.value.conversations.some((summary) => summary.id === id);
  }

  /**
   * Create a conversation in a workspace, titled after the first message, which the caller submits next. The list
   * shows it from here on.
   */
  async create(
    workspaceId: number,
    firstMessage: string,
    agent: Omit<AgentChange, "cwd">,
    context: Context,
  ): Promise<HarnessConversation> {
    const workspace = this.#workspaces.get(workspaceId);
    if (workspace === undefined) throw invalidInput(`Project ${workspaceId} does not exist`);
    const stats = await stat(workspace.path).catch(() => undefined);
    if (stats?.isDirectory() !== true) throw invalidInput(`The project's directory is gone: ${workspace.path}`);
    const createdAt = this.#now();
    const title = toTitle(firstMessage);
    const conversation = await this.#harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        // Without a model, the first message reports that none is selected.
        agent: { ...agent, cwd: workspace.path },
        init: async (tx, id) => {
          const meta = await tx.doc(ConversationMetaDoc, id);
          meta.createdAt = createdAt;
          meta.updatedAt = createdAt;
          meta.workspaceId = workspaceId;
          meta.title = title;
        },
      },
      context,
    );
    this.#stored.set(conversation.id, {
      id: conversation.id,
      workspaceId,
      cwd: workspace.path,
      createdAt,
      updatedAt: createdAt,
      title,
    });
    this.#publish();
    return conversation;
  }

  /** Marks the conversation active now, after a message was sent to it. */
  async noteMessage(id: number, context: Context): Promise<void> {
    const summary = this.#stored.get(id);
    if (summary === undefined) return;
    const updatedAt = this.#now();
    await this.#harness.commit(async (tx) => {
      (await tx.doc(ConversationMetaDoc, id as ConversationId)).updatedAt = updatedAt;
    }, context);
    this.#stored.set(id, { ...summary, updatedAt });
    this.#publish();
  }

  dispose(): void {
    for (const stop of this.#stop.splice(0)) stop();
  }

  async #followTasks(context: Context): Promise<void> {
    const graph: AttachedReplicatedState<TaskGraph> = await this.#harness.taskGraph(context);
    const update = (value: TaskGraph): void => {
      const running = runningConversations(value);
      if (sameSet(running, this.#running)) return;
      this.#running = running;
      this.#publish();
    };
    update(graph.value);
    const unsubscribe = graph.subscribe((value) => update(value));
    this.#stop.push(() => {
      unsubscribe();
      graph.dispose();
    });
  }

  #list(): ConversationSummary[] {
    return [...this.#stored.values()]
      .filter((summary) => this.#workspaces.isListed(summary.workspaceId))
      .sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id)
      .map((summary) => ({ ...summary, running: this.#running.has(summary.id) }));
  }

  #publish(): void {
    const conversations = this.#list();
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.conversations = conversations;
    });
  }
}

/** The summary of a conversation Tandem created, with its workspace given if it predates workspaces. */
async function readSummary(
  harness: Harness,
  workspaces: WorkspaceCatalog,
  id: ConversationId,
  context: Context,
): Promise<Stored | undefined> {
  const [agent, meta] = await Promise.all([
    harness.snapshot(AgentDoc, id, context),
    harness.snapshot(ConversationMetaDoc, id, context),
  ]);
  // Without both, the conversation was not created by Tandem. Without a title, it never got a message.
  if (agent?.cwd === undefined || meta?.title === undefined) return undefined;
  let workspaceId = meta.workspaceId;
  if (workspaceId === undefined) {
    const assigned = await workspaces.forPath(agent.cwd, context);
    await harness.commit(async (tx) => {
      (await tx.doc(ConversationMetaDoc, id)).workspaceId = assigned;
    }, context);
    workspaceId = assigned;
  }
  return {
    id,
    workspaceId,
    cwd: agent.cwd,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt ?? meta.createdAt,
    title: meta.title,
  };
}

/** Conversations with a live task they own directly, not counting background tasks. */
function runningConversations(graph: TaskGraph): Set<number> {
  const running = new Set<number>();
  for (const task of Object.values(graph.tasks)) {
    if (task.owner === undefined && !task.background) running.add(task.conversationId);
  }
  return running;
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function toTitle(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= TITLE_LENGTH ? line : `${line.slice(0, TITLE_LENGTH - 1)}…`;
}
