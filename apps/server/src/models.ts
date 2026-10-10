import type { Message, Models } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { type FauxResponseFactory, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import type { ModelRef } from "@earendil-works/pi-durable";

export interface AppModels {
  readonly models: Models;
  /** The model new conversations start with. */
  readonly defaultModel: ModelRef;
}

export interface FauxModelsOptions {
  /** Streaming speed of answers; unlimited when absent. */
  tokensPerSecond?: number;
  /** The answer to the last user message. Default: echo it back. */
  reply?: (text: string) => string;
}

/** A local model that answers without a network. Real providers replace it in M1. */
export function createFauxModels(options: FauxModelsOptions = {}): AppModels {
  const reply = options.reply ?? ((text) => `You said: ${text}`);
  const faux = fauxProvider({
    ...(options.tokensPerSecond === undefined ? {} : { tokensPerSecond: options.tokensPerSecond }),
  });
  // Every response step is used once, so each answer queues the next one.
  const answer: FauxResponseFactory = (context) => {
    faux.appendResponses([answer]);
    return fauxAssistantMessage(reply(lastUserText(context.messages)));
  };
  faux.setResponses([answer]);
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  return { models, defaultModel: { provider: model.provider, modelId: model.id } };
}

function lastUserText(messages: readonly Message[]): string {
  const message = messages.findLast((candidate) => candidate.role === "user");
  if (message === undefined || message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}
