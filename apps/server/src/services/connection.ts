import { RemoteServiceProvider } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import { Conversation, Conversations } from "@tandem/contracts";
import type { ConnectionServices } from "../rpc-host.ts";
import { createConversationService } from "./conversation.ts";
import type { ConversationCatalog } from "./conversations.ts";
import { invalidInput } from "./errors.ts";

export interface AppServices {
  readonly harness: Harness;
  readonly catalog: ConversationCatalog;
}

/** An open conversation on one connection. */
interface OpenConversation {
  close(): void;
}

/** The services of one client connection: the shared conversation list, and the conversations it opened. */
export function createConnectionServices({ harness, catalog }: AppServices): ConnectionServices {
  const provider = new RemoteServiceProvider([Conversations, { service: Conversation, mode: "keyed" }]);
  const opened = new Map<number, Promise<OpenConversation>>();
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
        createConversationService(conversation, view, (text, context) => catalog.noteMessage(id, text, context)),
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

  provider.provide(Conversations, {
    state: catalog.state,
    async create(input, context) {
      const { cwd } = (input ?? {}) as { cwd?: unknown };
      if (typeof cwd !== "string") throw invalidInput("cwd must be a string");
      return (await catalog.create(cwd, context)).id;
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
      for (const opening of opened.values())
        void opening.then(
          (conversation) => conversation.close(),
          () => {},
        );
      opened.clear();
    },
  };
}

function parseId(id: unknown): asserts id is number {
  if (!Number.isSafeInteger(id) || (id as number) < 0)
    throw invalidInput("Conversation ID must be a non-negative integer");
}
