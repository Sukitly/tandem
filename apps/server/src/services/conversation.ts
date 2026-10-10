import type { AttachedReplicatedState, Context } from "@earendil-works/chord";
import type { ConversationView, Conversation as HarnessConversation } from "@earendil-works/pi-durable";
import type { Conversation, SubmitInput } from "@tandem/contracts";
import { invalidInput } from "./errors.ts";

/** The `Conversation` instance one connection receives for one open conversation. */
export function createConversationService(
  conversation: HarnessConversation,
  view: AttachedReplicatedState<ConversationView>,
  onSubmitted: (text: string, context: Context) => Promise<void>,
): Conversation {
  return {
    view,
    async submit(input, context) {
      const { text, whenBusy } = parseSubmitInput(input);
      await conversation.submit({ type: "input", content: text, whenBusy }, context);
      await onSubmitted(text, context);
    },
    abort: (context) => conversation.abort(context),
  };
}

function parseSubmitInput(input: unknown): SubmitInput {
  const { text, whenBusy } = (input ?? {}) as Partial<SubmitInput>;
  if (typeof text !== "string" || text.trim() === "") throw invalidInput("text must be a non-empty string");
  if (whenBusy !== "steer" && whenBusy !== "followUp") throw invalidInput('whenBusy must be "steer" or "followUp"');
  return { text, whenBusy };
}
