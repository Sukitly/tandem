import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { type Context, type MutableReplicatedState, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  AgentDoc,
  type ConversationId,
  type Cursor,
  defineDoc,
  type Harness,
  type ModelRef,
} from "@earendil-works/pi-durable";
import type { ConversationSummary, ConversationsState } from "@tandem/contracts";
import { invalidInput } from "./errors.ts";

/** What Tandem stores about a conversation besides pi's own documents. */
type ConversationMeta = { createdAt: number; title?: string };

const ConversationMetaDoc = defineDoc<ConversationMeta>({
  kind: "tandem.conversation",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ createdAt: 0 }),
});

const TITLE_LENGTH = 80;

/**
 * The conversation list shared by every connection. It is the only writer of conversation metadata, so it updates the
 * list after each of its own commits instead of following the Harness's commits.
 */
export class ConversationCatalog {
  readonly #harness: Harness;
  readonly #defaultModel: () => ModelRef | undefined;
  readonly #now: () => number;
  readonly #state: MutableReplicatedState<ConversationsState>;

  private constructor(
    harness: Harness,
    defaultModel: () => ModelRef | undefined,
    now: () => number,
    initial: ConversationSummary[],
  ) {
    this.#harness = harness;
    this.#defaultModel = defaultModel;
    this.#now = now;
    this.#state = replicatedState<ConversationsState>({ conversations: initial });
  }

  /** Lists the conversations users created. Conversations that tasks own, such as subagents', are not listed. */
  static async load(
    harness: Harness,
    defaultModel: () => ModelRef | undefined,
    context: Context,
    now: () => number = Date.now,
  ): Promise<ConversationCatalog> {
    const summaries: ConversationSummary[] = [];
    let cursor: Cursor | undefined;
    do {
      const page = await harness.commit((tx) => tx.scanConversations({}, 256, cursor), context);
      for (const record of page.items) {
        if (record.owner !== undefined) continue;
        const summary = await readSummary(harness, record.id, context);
        if (summary !== undefined) summaries.push(summary);
      }
      cursor = page.next;
    } while (cursor !== undefined);
    summaries.sort(newestFirst);
    return new ConversationCatalog(harness, defaultModel, now, summaries);
  }

  get state(): MutableReplicatedState<ConversationsState> {
    return this.#state;
  }

  has(id: number): boolean {
    return this.#state.value.conversations.some((summary) => summary.id === id);
  }

  async create(cwdInput: string, context: Context): Promise<ConversationSummary> {
    const cwd = await validateDirectory(cwdInput);
    const createdAt = this.#now();
    const model = this.#defaultModel();
    const conversation = await this.#harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        // Without a model, the first message reports that none is selected.
        agent: { cwd, ...(model === undefined ? {} : { model }) },
        init: async (tx, id) => {
          const meta = await tx.doc(ConversationMetaDoc, id);
          meta.createdAt = createdAt;
        },
      },
      context,
    );
    const summary: ConversationSummary = { id: conversation.id, cwd, createdAt };
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.conversations.unshift(summary);
    });
    return summary;
  }

  /** Titles an untitled conversation after the message just sent to it. */
  async noteMessage(id: number, text: string, context: Context): Promise<void> {
    const summary = this.#state.value.conversations.find((candidate) => candidate.id === id);
    const title = toTitle(text);
    if (summary === undefined || summary.title !== undefined || title === "") return;
    await this.#harness.commit(async (tx) => {
      const meta = await tx.doc(ConversationMetaDoc, id as ConversationId);
      meta.title ??= title;
    }, context);
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      const listed = draft.conversations.find((candidate) => candidate.id === id);
      if (listed !== undefined) listed.title ??= title;
    });
  }
}

async function readSummary(
  harness: Harness,
  id: ConversationId,
  context: Context,
): Promise<ConversationSummary | undefined> {
  const [agent, meta] = await Promise.all([
    harness.snapshot(AgentDoc, id, context),
    harness.snapshot(ConversationMetaDoc, id, context),
  ]);
  // Without both, the conversation was not created by Tandem.
  if (agent?.cwd === undefined || meta === undefined) return undefined;
  return { id, cwd: agent.cwd, createdAt: meta.createdAt, ...(meta.title === undefined ? {} : { title: meta.title }) };
}

async function validateDirectory(path: string): Promise<string> {
  if (typeof path !== "string" || !isAbsolute(path)) throw invalidInput("cwd must be an absolute path");
  const resolved = resolve(path);
  const stats = await stat(resolved).catch(() => undefined);
  if (stats?.isDirectory() !== true) throw invalidInput(`Not a directory: ${resolved}`);
  return resolved;
}

function toTitle(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= TITLE_LENGTH ? line : `${line.slice(0, TITLE_LENGTH - 1)}…`;
}

function newestFirst(a: ConversationSummary, b: ConversationSummary): number {
  return b.createdAt - a.createdAt || b.id - a.id;
}
