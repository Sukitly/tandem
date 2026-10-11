import type { CredentialStore, Message, MutableModels, Provider } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { type FauxResponseFactory, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";

/** Every provider pi-ai ships. */
export function defaultProviders(): Provider[] {
  return builtinProviders();
}

/** Models over `providers`, with credentials from `credentials` and the environment. */
export function createAppModels(credentials: CredentialStore, providers: readonly Provider[]): MutableModels {
  const models = createModels({ credentials });
  for (const provider of providers) models.setProvider(provider);
  return models;
}

export interface FauxOptions {
  /** Streaming speed of answers; unlimited when absent. */
  tokensPerSecond?: number;
  /** The answer to the last user message. Default: echo it back. */
  reply?: (text: string) => string;
}

/** A model that answers locally without a network or credentials, for tests and for trying the UI. */
export function createFauxProvider(options: FauxOptions = {}): Provider {
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
  return faux.provider;
}

/** A reply that exercises the transcript's rendering: Markdown, a list, and a code block. */
export function demoReply(text: string): string {
  return [
    `You said: **${text}**`,
    "",
    "This answer comes from the faux model, which runs without a network. It streams slowly on purpose, so you can watch it arrive and stop it halfway.",
    "",
    "- Reload the page: the conversation is still here.",
    "- Open a second tab: both show the same answer as it streams.",
    "- Restart the server while it streams: the answer completes after the restart.",
    "",
    "```ts",
    'const greeting = "hello";',
    "console.log(greeting);",
    "```",
  ].join("\n");
}

function lastUserText(messages: readonly Message[]): string {
  const message = messages.findLast((candidate) => candidate.role === "user");
  if (message === undefined || message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}
