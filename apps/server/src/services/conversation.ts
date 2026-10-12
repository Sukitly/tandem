import { randomUUID } from "node:crypto";
import {
  type AttachedReplicatedState,
  type Context,
  type MutableReplicatedState,
  replicatedState,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { clampThinkingLevel, type ImageContent, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import type {
  AgentChange,
  Conversation as HarnessConversation,
  SettledSubmissionRecord,
  UserInput,
} from "@earendil-works/pi-durable";
import type {
  Conversation,
  ConversationNotices,
  ConversationView,
  ImageInput,
  ModelRef,
  SubmitInput,
} from "@tandem/contracts";
import type { ImageProcessor } from "../images/image-processor.ts";
import { ImageRefused, imageModel, parseImageInputs, prepareImages } from "../images/message-images.ts";
import type { CommentBoard, TakenComments } from "./comments.ts";
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

  add(conversationId: number, message: string): void {
    const id = this.#nextId++;
    this.get(conversationId).change(BACKGROUND_CONTEXT, (draft) => {
      draft.notices.push({ id, message });
    });
  }
}

export interface ConversationServiceOptions {
  conversation: HarnessConversation;
  view: AttachedReplicatedState<ConversationView>;
  notices: NoticeBoard;
  models: ModelCatalog;
  comments: CommentBoard;
  images: ImageProcessor;
  /** The project the conversation belongs to, whose comments its messages may carry. */
  workspaceId: () => number | undefined;
  onSubmitted: (text: string, context: Context) => Promise<void>;
}

/** The `Conversation` instance one connection receives for one open conversation. */
export function createConversationService({
  conversation,
  view,
  notices,
  models,
  comments,
  images,
  workspaceId,
  onSubmitted,
}: ConversationServiceOptions): Conversation {
  const id = conversation.id as number;
  return {
    view,
    notices: notices.get(id),
    async submit(input, context) {
      const { text, whenBusy, comments: ids, images: sent } = parseSubmitInput(input);
      // The model is looked up only for a message with images: it is what they are fitted to.
      const current = sent === undefined || sent.length === 0 ? undefined : (await conversation.agent(context)).model;
      const attached = await imagesFor(sent, current === undefined ? undefined : models.available(current), images);
      const project = workspaceId();
      const taken = project === undefined ? undefined : comments.take(project, ids);
      const message = joinMessage(taken?.text ?? "", text);
      if (message === "" && attached.length === 0) {
        taken?.release();
        throw invalidInput("Write a message, or a comment to send");
      }
      await sendWithComments(conversation, notices, taken, { text: message, images: attached, whenBusy }, context);
      await onSubmitted(message, context);
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
  };
}

/**
 * Submit a message with the comments it carries, and mark them sent once it is taken. A refused message leaves them
 * waiting. Once the message is taken the call succeeds: failing it would have the user send the message again. If
 * marking the comments fails then, they stay waiting and the failure goes to the server's error report.
 */
export async function sendWithComments(
  conversation: HarnessConversation,
  notices: NoticeBoard,
  taken: TakenComments | undefined,
  input: MessageInput,
  context: Context,
): Promise<void> {
  const requestId = randomUUID();
  try {
    await submitMessage(conversation, notices, input, context, requestId);
  } catch (error) {
    taken?.release();
    throw error;
  }
  await taken?.sent({ conversationId: conversation.id as number, requestId }, BACKGROUND_CONTEXT).catch(() => {
    // Reported by the board; the message went out all the same.
  });
}

/** What the agent receives: the comments' text, then what the user typed. */
export function joinMessage(comments: string, text: string): string {
  return [comments, text.trim()].filter((part) => part !== "").join("\n\n");
}

/** What a message is made of once its comments are written in and its images fitted to the model. */
export interface MessageInput {
  text: string;
  images?: ImageContent[];
  whenBusy: SubmitInput["whenBusy"];
}

/**
 * The images of a message, fitted to `model`, the conversation's: refused with a message the page shows when the
 * model cannot take them.
 */
export async function imagesFor(
  sent: ImageInput[] | undefined,
  model: Parameters<typeof imageModel>[0],
  processor: ImageProcessor,
): Promise<ImageContent[]> {
  if (sent === undefined || sent.length === 0) return [];
  try {
    return await prepareImages(sent, imageModel(model), processor);
  } catch (error) {
    if (error instanceof ImageRefused) throw invalidInput(error.message);
    throw error;
  }
}

/** Submit a message. The answer arrives in the view; a message that gets none leaves a notice saying why. */
export async function submitMessage(
  conversation: HarnessConversation,
  notices: NoticeBoard,
  { text, images = [], whenBusy }: MessageInput,
  context: Context,
  requestId?: string,
): Promise<void> {
  const id = conversation.id as number;
  notices.clear(id);
  // Text alone stays a string, as before images: the transcript of such a message is unchanged.
  const content: UserInput =
    images.length === 0 ? text : [...(text === "" ? [] : [{ type: "text" as const, text }]), ...images];
  const submission = await conversation.submit(
    { type: "input", content, whenBusy, ...(requestId === undefined ? {} : { requestId }) },
    context,
  );
  void submission.wait(BACKGROUND_CONTEXT).then(
    (settled) => {
      const message = unansweredMessage(settled);
      if (message !== undefined) notices.add(id, message);
    },
    () => {},
  );
}

/**
 * The agent settings a new conversation starts with: the chosen model, or else the default one, and the chosen
 * thinking level lowered to one the model supports.
 */
export function initialAgent(
  models: ModelCatalog,
  input: { model?: unknown; thinkingLevel?: unknown },
): { model?: ModelRef; thinkingLevel?: ModelThinkingLevel } {
  const { model: ref, thinkingLevel } = input;
  let chosen: ModelRef | undefined;
  if (ref !== undefined) {
    const { provider, modelId } = (ref ?? {}) as Partial<ModelRef>;
    if (typeof provider !== "string" || typeof modelId !== "string") throw invalidInput("Invalid model");
    if (models.available({ provider, modelId }) === undefined)
      throw invalidInput(`Model is not available: ${provider}/${modelId}`);
    chosen = { provider, modelId };
  }
  const model = chosen ?? models.defaultModel();
  if (thinkingLevel !== undefined && typeof thinkingLevel !== "string")
    throw invalidInput("thinkingLevel must be a string");
  const summary = model === undefined ? undefined : models.available(model);
  return {
    ...(model === undefined ? {} : { model }),
    ...(thinkingLevel === undefined
      ? {}
      : {
          thinkingLevel:
            summary === undefined
              ? (thinkingLevel as ModelThinkingLevel)
              : clampThinkingLevel(summary, thinkingLevel as ModelThinkingLevel),
        }),
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

/** The message's parts. The text may be empty here; the message as a whole may not, which is checked once it is put together. */
export function parseSubmitInput(input: unknown): SubmitInput {
  const { text, whenBusy, comments, images } = (input ?? {}) as Partial<SubmitInput>;
  if (typeof text !== "string") throw invalidInput("text must be a string");
  if (whenBusy !== "steer" && whenBusy !== "followUp") throw invalidInput('whenBusy must be "steer" or "followUp"');
  if (comments !== undefined && !(Array.isArray(comments) && comments.every((id) => Number.isSafeInteger(id))))
    throw invalidInput("comments must be a list of message IDs");
  let parsed: ImageInput[] | undefined;
  try {
    parsed = parseImageInputs(images);
  } catch (error) {
    if (error instanceof ImageRefused) throw invalidInput(error.message);
    throw error;
  }
  return {
    text,
    whenBusy,
    ...(comments === undefined ? {} : { comments }),
    ...(parsed === undefined ? {} : { images: parsed }),
  };
}
