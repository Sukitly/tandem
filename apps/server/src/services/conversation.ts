import {
  type AttachedReplicatedState,
  type Context,
  type MutableReplicatedState,
  replicatedState,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { clampThinkingLevel, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import type {
  AgentChange,
  ConversationView,
  Harness,
  Conversation as HarnessConversation,
  SettledSubmissionRecord,
} from "@earendil-works/pi-durable";
import type { Conversation, ConversationNotice, ConversationNotices, ModelRef, SubmitInput } from "@tandem/contracts";
import { invalidInput } from "./errors.ts";
import type { ModelCatalog } from "./models.ts";

/** Submissions that end without an answer for these reasons need no notice: the user asked for it, or it was replaced. */
const QUIET_REASONS = new Set(["aborted", "reset", "stale"]);

/** Notices of every conversation, shared by all connections. In memory only. */
export class NoticeBoard {
  readonly #boards = new Map<number, MutableReplicatedState<ConversationNotices>>();
  #nextId = 1;

  get(conversationId: number): MutableReplicatedState<ConversationNotices> {
    let board = this.#boards.get(conversationId);
    if (board === undefined) {
      board = replicatedState<ConversationNotices>({ notices: [] });
      this.#boards.set(conversationId, board);
    }
    return board;
  }

  clear(conversationId: number): void {
    const board = this.#boards.get(conversationId);
    if (board !== undefined && board.value.notices.length > 0) board.replace(BACKGROUND_CONTEXT, { notices: [] });
  }

  add(conversationId: number, notice: Omit<ConversationNotice, "id">): void {
    const id = this.#nextId++;
    this.get(conversationId).change(BACKGROUND_CONTEXT, (draft) => {
      draft.notices.push({ id, ...notice });
    });
  }
}

export interface ConversationServiceOptions {
  harness: Harness;
  conversation: HarnessConversation;
  view: AttachedReplicatedState<ConversationView>;
  notices: NoticeBoard;
  models: ModelCatalog;
  onSubmitted: (text: string, context: Context) => Promise<void>;
}

/** The `Conversation` instance one connection receives for one open conversation. */
export function createConversationService({
  harness,
  conversation,
  view,
  notices,
  models,
  onSubmitted,
}: ConversationServiceOptions): Conversation {
  const id = conversation.id as number;
  return {
    view,
    notices: notices.get(id),
    async submit(input, context) {
      const { text, whenBusy } = parseSubmitInput(input);
      notices.clear(id);
      const submission = await conversation.submit({ type: "input", content: text, whenBusy }, context);
      // The answer arrives in the view; only a missing answer needs telling.
      void submission.wait(BACKGROUND_CONTEXT).then(
        (settled) => {
          const message = unansweredMessage(settled);
          if (message !== undefined) notices.add(id, { tone: "error", title: "No answer", message });
        },
        () => {},
      );
      await onSubmitted(text, context);
    },
    abort: (context) => conversation.abort(context),
    async configure(input, context) {
      const { model: ref, thinkingLevel } = (input ?? {}) as { model?: ModelRef; thinkingLevel?: unknown };
      const change: { -readonly [K in keyof AgentChange]: AgentChange[K] } = {};
      let model = undefined as ReturnType<ModelCatalog["available"]>;
      if (ref !== undefined) {
        if (typeof ref?.provider !== "string" || typeof ref.modelId !== "string") throw invalidInput("Invalid model");
        model = models.available(ref);
        if (model === undefined) throw invalidInput(`Model is not available: ${ref.provider}/${ref.modelId}`);
        change.model = { provider: ref.provider, modelId: ref.modelId };
      } else {
        const current = (await conversation.agent(context)).model;
        model = current === undefined ? undefined : models.available(current);
      }
      if (thinkingLevel !== undefined) {
        if (typeof thinkingLevel !== "string") throw invalidInput("thinkingLevel must be a string");
        change.thinkingLevel =
          model === undefined
            ? (thinkingLevel as ModelThinkingLevel)
            : clampThinkingLevel(model, thinkingLevel as ModelThinkingLevel);
      } else if (model !== undefined && ref !== undefined) {
        // Keep the current level where the new model supports it.
        const current = (await conversation.agent(context)).thinkingLevel;
        change.thinkingLevel = clampThinkingLevel(model, current);
      }
      await conversation.configure(change, context);
    },
    async compact(input, context) {
      const { instructions } = (input ?? {}) as { instructions?: unknown };
      if (instructions !== undefined && typeof instructions !== "string") {
        throw invalidInput("instructions must be a string");
      }
      if ((await conversation.agent(context)).model === undefined) throw invalidInput("No model is selected");
      notices.clear(id);
      const task = await conversation.compact(
        instructions === undefined || instructions === "" ? undefined : instructions,
        context,
      );
      // The compaction runs on; report how it ended when it adds nothing to the transcript.
      void harness.waitForTask(task, BACKGROUND_CONTEXT).then(
        ({ state: { outcome } }) => {
          if (outcome.status === "completed" && outcome.result.entryId === undefined) {
            notices.add(id, {
              tone: "info",
              title: "Nothing to compact",
              message: "The conversation is still short enough to keep in full.",
            });
          } else if (outcome.status === "failed") {
            notices.add(id, { tone: "error", title: "Compaction failed", message: outcome.error.message });
          }
        },
        () => {},
      );
    },
  };
}

function unansweredMessage(settled: SettledSubmissionRecord): string | undefined {
  if (settled.status !== "unanswered") return undefined;
  const { reason, detail } = settled as SettledSubmissionRecord & { reason?: string; detail?: unknown };
  if (reason === undefined || QUIET_REASONS.has(reason)) return undefined;
  if (reason === "no_model") return "No model is selected. Sign in to a provider and choose a model.";
  if (reason === "model_error") return typeof detail === "string" ? detail : "The model returned an error.";
  return `The message got no answer (${reason}).`;
}

function parseSubmitInput(input: unknown): SubmitInput {
  const { text, whenBusy } = (input ?? {}) as Partial<SubmitInput>;
  if (typeof text !== "string" || text.trim() === "") throw invalidInput("text must be a non-empty string");
  if (whenBusy !== "steer" && whenBusy !== "followUp") throw invalidInput('whenBusy must be "steer" or "followUp"');
  return { text, whenBusy };
}
