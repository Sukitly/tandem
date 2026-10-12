import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { connect, type TandemConnection } from "@tandem/client";
import {
  type CommentAnchor,
  Comments,
  type CommentThread,
  Conversation,
  Conversations,
  type ConversationView,
  Workspaces,
  waitingMessages,
} from "@tandem/contracts";
import { afterEach, describe, expect, test } from "vitest";
import { startApp } from "../src/app.ts";
import { createFauxProvider } from "../src/models.ts";
import type { TandemServer } from "../src/server.ts";
import { threadText } from "../src/services/comments.ts";

const context = BACKGROUND_CONTEXT;
const servers: TandemServer[] = [];
const connections: TandemConnection[] = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

const anchor: CommentAnchor = {
  path: "src/app.ts",
  line: 42,
  quote: "const retries = 3;",
  before: ["function start() {"],
  after: ["}"],
};

async function start(stateDir?: string, respond?: (messages: readonly Message[]) => AssistantMessage) {
  const dir = stateDir ?? (await mkdtemp(join(tmpdir(), "tandem-test-")));
  const provider = createFauxProvider(respond === undefined ? {} : { respond });
  const server = await startApp({ port: 0, providers: [provider], stateDir: dir });
  servers.push(server);
  return { server, stateDir: dir };
}

async function client(server: TandemServer) {
  const connection = await connect({
    baseUrl: server.url,
    token: server.token,
    services: [Workspaces, Comments, Conversations, Conversation],
  });
  connections.push(connection);
  const open = new Map<number, Conversation>();
  connection.services.observe(Conversation, async (instance, instanceContext: Context) => {
    await waitFor(() => instance.view.value !== undefined);
    const id = instance.view.value?.conversation.id ?? -1;
    open.set(id, instance);
    instanceContext.abortSignal?.addEventListener("abort", () => open.delete(id));
  });
  await connection.services.ready(context);
  const comments = connection.services.use(Comments);
  const conversations = connection.services.use(Conversations);
  const threads = (): CommentThread[] => comments.state.value?.threads ?? [];
  const openConversation = async (id: number): Promise<{ conversation: Conversation }> => {
    await conversations.open(id, context);
    await waitFor(() => open.has(id));
    return { conversation: open.get(id) as Conversation };
  };
  return {
    workspaces: connection.services.use(Workspaces),
    comments,
    conversations,
    threads,
    openConversation,
    view: (id: number) => open.get(id)?.view.value,
  };
}

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The text of each user message in a conversation. */
function userMessages(view: ConversationView | undefined): string[] {
  return (view?.entries ?? []).flatMap((entry) =>
    (entry.model ?? []).flatMap((message) =>
      message.role === "user"
        ? [
            typeof message.content === "string"
              ? message.content
              : message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
          ]
        : [],
    ),
  );
}

function waitingIds(threads: CommentThread[]): number[] {
  return threads.flatMap((thread) => waitingMessages(thread).map((message) => message.id));
}

describe("comment threads", () => {
  test("are kept by the server, shared by its clients, and survive a restart", async () => {
    const first = await start();
    const a = await client(first.server);
    const b = await client(first.server);
    const workspaceId = await a.workspaces.add({ path: tmpdir() }, context);

    const threadId = await a.comments.start({ workspaceId, anchor, text: " Read it from the config. " }, context);
    await waitFor(() => b.threads().length === 1);
    expect(b.threads()[0]).toMatchObject({
      id: threadId,
      workspaceId,
      anchor,
      messages: [{ author: "user", text: "Read it from the config." }],
    });
    const thread = b.threads()[0] as CommentThread;
    await b.comments.edit({ threadId, messageId: thread.messages[0]?.id ?? -1, text: "Or an argument." }, context);
    await b.comments.reply({ threadId, text: "And name it." }, context);
    await waitFor(() => a.threads()[0]?.messages.length === 2);
    expect(a.threads()[0]?.messages.map((message) => message.text)).toEqual(["Or an argument.", "And name it."]);

    for (const server of servers.splice(0)) await server.stop();
    const second = await start(first.stateDir);
    const c = await client(second.server);
    await waitFor(() => c.threads().length === 1);
    expect(c.threads()[0]?.messages.map((message) => message.text)).toEqual(["Or an argument.", "And name it."]);
  });

  test("go with the next message, and only the ones it names", async () => {
    const { server } = await start();
    const { workspaces, comments, conversations, threads, openConversation, view } = await client(server);
    const workspaceId = await workspaces.add({ path: tmpdir() }, context);
    await comments.start({ workspaceId, anchor, text: "Read it from the config." }, context);
    await comments.start({ workspaceId, anchor: { ...anchor, line: 7, quote: "" }, text: "Later." }, context);
    await waitFor(() => threads().length === 2);
    const [sentId] = waitingIds(threads());

    // A conversation started by comments alone.
    const id = await conversations.start({ workspaceId, text: "", comments: [sentId as number] }, context);
    const { conversation } = await openConversation(id);
    await waitFor(() => userMessages(view(id)).length === 1);
    expect(userMessages(view(id))[0]).toBe(
      ["Comment #1 on [src/app.ts:42](src/app.ts#L42)", "> const retries = 3;", "Read it from the config."].join(
        "\n\n",
      ),
    );
    expect(conversations.state.value?.conversations[0]?.title).toBe("Review of src/app.ts:42");
    await waitFor(() => waitingIds(threads()).length === 1);
    expect(threads()[0]?.messages[0]?.sent).toMatchObject({ conversationId: id });
    expect(waitingIds(threads())).not.toContain(sentId);

    // Sending it again carries nothing: it is not waiting any more.
    await expect(
      conversation.submit({ text: "", comments: [sentId as number], whenBusy: "followUp" }, context),
    ).rejects.toThrow(/Write a message/);

    // A reply on a sent thread goes with the thread so far, and what the user typed comes last.
    await comments.reply({ threadId: 1, text: "Still there." }, context);
    await waitFor(() => waitingIds(threads()).length === 2);
    const replyId = threads()[0]?.messages[1]?.id as number;
    await conversation.submit({ text: "Thanks.", comments: [replyId], whenBusy: "followUp" }, context);
    await waitFor(() => userMessages(view(id)).length === 2);
    expect(userMessages(view(id))[1]).toBe(
      [
        "Comment #1 on [src/app.ts:42](src/app.ts#L42)",
        "> const retries = 3;",
        "**User:** Read it from the config.",
        "**User:** Still there.",
        "Thanks.",
      ].join("\n\n"),
    );
  });

  test("a sent comment is not edited or taken back, and a thread is deleted whole", async () => {
    const { server } = await start();
    const { workspaces, comments, conversations, threads } = await client(server);
    const workspaceId = await workspaces.add({ path: tmpdir() }, context);
    const threadId = await comments.start({ workspaceId, anchor, text: "One." }, context);
    await waitFor(() => threads().length === 1);
    const messageId = threads()[0]?.messages[0]?.id as number;
    await conversations.start({ workspaceId, text: "Go.", comments: [messageId] }, context);
    await waitFor(() => waitingIds(threads()).length === 0);

    await expect(comments.edit({ threadId, messageId, text: "Two." }, context)).rejects.toThrow(/sent already/);
    await expect(comments.withdraw({ threadId, messageId }, context)).rejects.toThrow(/sent already/);
    await comments.remove(threadId, context);
    await waitFor(() => threads().length === 0);
  });

  test("taking back a thread's only message drops the thread", async () => {
    const { server } = await start();
    const { workspaces, comments, threads } = await client(server);
    const workspaceId = await workspaces.add({ path: tmpdir() }, context);
    const threadId = await comments.start({ workspaceId, anchor, text: "One." }, context);
    await waitFor(() => threads().length === 1);
    await comments.withdraw({ threadId, messageId: threads()[0]?.messages[0]?.id as number }, context);
    await waitFor(() => threads().length === 0);
  });

  test("a message that is refused leaves its comments waiting", async () => {
    const { server } = await start();
    const { workspaces, comments, conversations, threads } = await client(server);
    const workspaceId = await workspaces.add({ path: tmpdir() }, context);
    await comments.start({ workspaceId, anchor, text: "One." }, context);
    await waitFor(() => threads().length === 1);
    const ids = waitingIds(threads());
    await expect(
      conversations.start(
        { workspaceId, text: "Go.", comments: ids, model: { provider: "none", modelId: "x" } },
        context,
      ),
    ).rejects.toThrow(/not available/);
    // And a later message can still take them.
    await conversations.start({ workspaceId, text: "Go.", comments: ids }, context);
    await waitFor(() => waitingIds(threads()).length === 0);
  });

  test("refuses what it cannot keep", async () => {
    const { server } = await start();
    const { workspaces, comments } = await client(server);
    const workspaceId = await workspaces.add({ path: tmpdir() }, context);
    await expect(comments.start({ workspaceId, anchor, text: "  " }, context)).rejects.toThrow(/Write the comment/);
    await expect(comments.start({ workspaceId: 999, anchor, text: "One." }, context)).rejects.toThrow(/does not exist/);
    await expect(
      comments.start({ workspaceId, anchor: { ...anchor, path: "/etc/passwd" }, text: "One." }, context),
    ).rejects.toThrow(/relative/);
    await expect(
      comments.start({ workspaceId, anchor: { ...anchor, line: 0 }, text: "One." }, context),
    ).rejects.toThrow(/line/);
    await expect(comments.start({ workspaceId, anchor, text: "x".repeat(10_001) }, context)).rejects.toThrow(/at most/);
  });
});

/** A model that replies to the first comment its message names, then reports what the tool said. */
function replyingModel(messages: readonly Message[]): AssistantMessage {
  const last = messages.at(-1);
  if (last?.role === "toolResult") {
    const said = last.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    return fauxAssistantMessage(`Tool said: ${said}`);
  }
  const text = JSON.stringify(last?.content ?? "");
  const threadId = Number(/Comment #(\d+)/.exec(text)?.[1] ?? "0");
  return fauxAssistantMessage(
    [fauxText("Replying."), fauxToolCall("reply_to_comment", { threadId, text: "Moved it to `config.ts`." })],
    { stopReason: "toolUse" },
  );
}

function assistantTexts(view: ConversationView | undefined): string[] {
  return (view?.entries ?? []).flatMap((entry) =>
    (entry.model ?? []).flatMap((message) =>
      message.role === "assistant"
        ? [message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")]
        : [],
    ),
  );
}

describe("the agent's replies", () => {
  test("join the thread, beside the user's messages, and are never waiting", async () => {
    const { server } = await start(undefined, replyingModel);
    const { workspaces, comments, conversations, threads, openConversation, view } = await client(server);
    const workspaceId = await workspaces.add({ path: tmpdir() }, context);
    const threadId = await comments.start({ workspaceId, anchor, text: "Read it from the config." }, context);
    await waitFor(() => threads().length === 1);

    const id = await conversations.start({ workspaceId, text: "", comments: waitingIds(threads()) }, context);
    await openConversation(id);
    await waitFor(() => threads()[0]?.messages.length === 2);
    expect(threads()[0]?.messages[1]).toMatchObject({
      author: "agent",
      text: "Moved it to `config.ts`.",
      conversationId: id,
    });
    expect(waitingIds(threads())).toEqual([]);
    await waitFor(() => assistantTexts(view(id)).some((text) => text.startsWith("Tool said:")));
    expect(assistantTexts(view(id))).toContain(`Tool said: Replied to comment #${threadId}.`);

    // A reply of the user's after it carries the agent's reply too.
    await comments.reply({ threadId, text: "Thanks." }, context);
    await waitFor(() => waitingIds(threads()).length === 1);
    const [replyId] = waitingIds(threads());
    const { conversation } = await openConversation(id);
    await conversation.submit({ text: "", comments: [replyId as number], whenBusy: "followUp" }, context);
    await waitFor(() => userMessages(view(id)).length === 2);
    expect(userMessages(view(id))[1]).toContain("**Agent:** Moved it to `config.ts`.");
  });

  test("reach only the threads of the conversation's project", async () => {
    const { server } = await start(undefined, replyingModel);
    const { workspaces, comments, conversations, threads, openConversation, view } = await client(server);
    const first = await workspaces.add({ path: tmpdir() }, context);
    const second = await workspaces.add({ path: await mkdtemp(join(tmpdir(), "tandem-other-")) }, context);
    await comments.start({ workspaceId: first, anchor, text: "Read it from the config." }, context);
    await waitFor(() => threads().length === 1);

    // The user names the thread in another project's conversation: the agent cannot reply there.
    const id = await conversations.start({ workspaceId: second, text: "See Comment #1." }, context);
    await openConversation(id);
    await waitFor(() => assistantTexts(view(id)).some((text) => text.startsWith("Tool said:")));
    expect(assistantTexts(view(id))).toContain("Tool said: There is no comment #1 in this project.");
    expect(threads()[0]?.messages).toHaveLength(1);
  });
});

/** A model that does what a message asks in the form `Reply #N: "text"` (the text as JSON), and otherwise answers. */
function askedModel(messages: readonly Message[]): AssistantMessage {
  const last = messages.at(-1);
  if (last?.role === "toolResult") {
    const said = last.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    return fauxAssistantMessage(`Tool said: ${said}`);
  }
  const content = last?.role === "user" ? last.content : "";
  const text =
    typeof content === "string" ? content : content.map((block) => (block.type === "text" ? block.text : "")).join("");
  const asked = /^Reply #(\d+): ("[\s\S]*")$/.exec(text);
  if (asked === null) return fauxAssistantMessage("Done.");
  const reply = JSON.parse(asked[2] ?? '""') as string;
  return fauxAssistantMessage([fauxToolCall("reply_to_comment", { threadId: Number(asked[1]), text: reply })], {
    stopReason: "toolUse",
  });
}

describe("the agent's replies are refused", () => {
  async function setUp() {
    const { server } = await start(undefined, askedModel);
    const app = await client(server);
    const workspaceId = await app.workspaces.add({ path: tmpdir() }, context);
    const threadId = await app.comments.start({ workspaceId, anchor, text: "Read it from the config." }, context);
    await waitFor(() => app.threads().length === 1);
    const id = await app.conversations.start({ workspaceId, text: "Hello." }, context);
    const { conversation } = await app.openConversation(id);
    await waitFor(() => assistantTexts(app.view(id)).includes("Done."));
    /** Ask the agent for a reply, and return what the tool told it. The text goes as JSON: a message is trimmed. */
    const ask = async (text: string): Promise<string> => {
      const before = assistantTexts(app.view(id)).length;
      await conversation.submit({ text: `Reply #${threadId}: ${JSON.stringify(text)}`, whenBusy: "followUp" }, context);
      await waitFor(() =>
        assistantTexts(app.view(id))
          .slice(before)
          .some((said) => said.startsWith("Tool said:")),
      );
      return (
        assistantTexts(app.view(id))
          .slice(before)
          .find((said) => said.startsWith("Tool said:")) ?? ""
      );
    };
    return { ...app, workspaceId, threadId, ask };
  }

  test("when empty or too long", async () => {
    const { ask, threads } = await setUp();
    expect(await ask("   ")).toBe("Tool said: The reply is empty.");
    expect(await ask("x".repeat(10_001))).toBe("Tool said: A reply is at most 10000 characters.");
    expect(threads()[0]?.messages).toHaveLength(1);
  });

  test("when the thread is full", async () => {
    const { ask, comments, threads, threadId } = await setUp();
    for (let index = 1; index < 100; index += 1) await comments.reply({ threadId, text: `Note ${index}.` }, context);
    await waitFor(() => threads()[0]?.messages.length === 100);
    expect(await ask("One more.")).toBe(`Tool said: Comment #${threadId} holds 100 messages, the most a thread can.`);
    expect(threads()[0]?.messages).toHaveLength(100);
  });

  test("when the project was removed", async () => {
    const { ask, workspaces, workspaceId, threadId } = await setUp();
    await workspaces.remove(workspaceId, context);
    expect(await ask("Still here?")).toBe(`Tool said: There is no comment #${threadId} in this project.`);
  });
});

describe("what the agent reads of a thread", () => {
  const thread: CommentThread = {
    id: 3,
    workspaceId: 1,
    anchor,
    messages: [
      { id: 1, author: "user", text: "Why three?", createdAt: 0, sent: { conversationId: 1, requestId: "r" } },
      { id: 2, author: "agent", text: "The API allows three.", createdAt: 0, conversationId: 1 },
      { id: 3, author: "user", text: "Make it a setting.", createdAt: 0 },
    ],
  };

  test("is the place, the line, and the note for a new thread", () => {
    expect(threadText({ ...thread, messages: thread.messages.slice(0, 1) }, thread.messages.slice(0, 1))).toBe(
      ["Comment #3 on [src/app.ts:42](src/app.ts#L42)", "> const retries = 3;", "Why three?"].join("\n\n"),
    );
  });

  test("carries the discussion so far with a reply", () => {
    expect(threadText(thread, thread.messages.slice(2))).toBe(
      [
        "Comment #3 on [src/app.ts:42](src/app.ts#L42)",
        "> const retries = 3;",
        "**User:** Why three?",
        "**Agent:** The API allows three.",
        "**User:** Make it a setting.",
      ].join("\n\n"),
    );
  });
});
