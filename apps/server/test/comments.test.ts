import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { connect, type TandemConnection } from "@tandem/client";
import {
  COMMENT_CONTEXT_LINES,
  type CommentAnchor,
  Comments,
  type CommentThread,
  Conversation,
  Conversations,
  type ConversationView,
  MAX_COMMENT_LENGTH,
  MAX_COMMENT_LINE_LENGTH,
  MAX_COMMENT_THREADS,
  MAX_THREAD_MESSAGES,
  Workspaces,
  waitingMessages,
} from "@tandem/contracts";
import { afterEach, describe, expect, test } from "vitest";
import { startApp } from "../src/app.ts";
import { createFauxProvider } from "../src/models.ts";
import type { TandemServer } from "../src/server.ts";

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

  test("a send carries the messages it names of a thread, with the quote when there is one", async () => {
    const { server } = await start();
    const { workspaces, comments, conversations, threads, openConversation, view } = await client(server);
    const workspaceId = await workspaces.add({ path: tmpdir() }, context);
    const threadId = await comments.start(
      { workspaceId, anchor: { ...anchor, quote: "  padded  " }, text: "One." },
      context,
    );
    await comments.reply({ threadId, text: "Two." }, context);
    await comments.reply({ threadId, text: "Three." }, context);
    await waitFor(() => waitingIds(threads()).length === 3);
    const [one, two, three] = waitingIds(threads()) as [number, number, number];
    const place = "Comment #1 on [src/app.ts:42](src/app.ts#L42)";
    const read = async (ids: number[]): Promise<string> => {
      const id = await conversations.start({ workspaceId, text: "", comments: ids }, context);
      await openConversation(id);
      await waitFor(() => userMessages(view(id)).length === 1);
      return userMessages(view(id))[0] as string;
    };

    // What was written after the newest message it names is not part of it.
    expect(await read([one])).toBe([place, "> padded", "One."].join("\n\n"));
    // Messages of one thread read as its discussion up to the newest of them.
    expect(await read([two, three])).toBe(
      [place, "> padded", "**User:** One.", "**User:** Two.", "**User:** Three."].join("\n\n"),
    );

    // A line that is only blank space is not quoted.
    const blank = await comments.start(
      { workspaceId, anchor: { ...anchor, line: 7, quote: "   " }, text: "Blank." },
      context,
    );
    await waitFor(() => threads().some((thread) => thread.id === blank));
    const blankId = threads().find((thread) => thread.id === blank)?.messages[0]?.id as number;
    expect(await read([blankId])).toBe(["Comment #2 on [src/app.ts:7](src/app.ts#L7)", "Blank."].join("\n\n"));
  });

  test("a send names its comments as a list of message IDs, and takes only those of its own project", async () => {
    const { server } = await start();
    const { workspaces, comments, conversations, threads, openConversation, view } = await client(server);
    const workspaceId = await workspaces.add({ path: tmpdir() }, context);
    const other = await workspaces.add({ path: await mkdtemp(join(tmpdir(), "tandem-other-")) }, context);
    await comments.start({ workspaceId: other, anchor, text: "Elsewhere." }, context);
    await waitFor(() => threads().length === 1);
    const elsewhere = waitingIds(threads())[0] as number;

    for (const bad of ["1", [1.5], ["1"]]) {
      await expect(conversations.start({ workspaceId, text: "Go.", comments: bad as never }, context)).rejects.toThrow(
        /list of message IDs/,
      );
    }
    const id = await conversations.start({ workspaceId, text: "Go.", comments: [elsewhere] }, context);
    await openConversation(id);
    await waitFor(() => userMessages(view(id)).length === 1);
    expect(userMessages(view(id))).toEqual(["Go."]);
    expect(waitingIds(threads())).toEqual([elsewhere]);
  });

  test("refuses an anchor it cannot place, and keeps the part of one that fits", async () => {
    const { server } = await start();
    const { workspaces, comments, threads } = await client(server);
    const workspaceId = await workspaces.add({ path: tmpdir() }, context);
    const place = (patch: Record<string, unknown>) =>
      comments.start({ workspaceId, anchor: { ...anchor, ...patch }, text: "One." } as never, context);
    await expect(place({ path: "" })).rejects.toThrow(/relative/);
    await expect(place({ path: "a".repeat(4097) })).rejects.toThrow(/relative/);
    await expect(place({ line: 1.5 })).rejects.toThrow(/line/);
    await expect(place({ line: "3" })).rejects.toThrow(/line/);
    await expect(place({ side: "sideways" })).rejects.toThrow(/side/);
    await expect(place({ quote: 3 })).rejects.toThrow(/quote/);
    await expect(place({ before: "x" })).rejects.toThrow(/list of lines/);
    await expect(place({ after: ["a", 1] })).rejects.toThrow(/list of lines/);
    await expect(comments.start({ workspaceId: "1", anchor, text: "One." } as never, context)).rejects.toThrow(
      /does not exist/,
    );
    expect(threads()).toEqual([]);

    // The longest path and the longest comment that are kept; lines are cut, and only the nearest ones stay.
    const long = "y".repeat(MAX_COMMENT_LINE_LENGTH + 1);
    const near = Array.from({ length: COMMENT_CONTEXT_LINES + 2 }, (_, index) => `line ${index}`);
    const path = "a".repeat(4096);
    await comments.start(
      {
        workspaceId,
        anchor: { path, line: 1, side: "deletions", quote: long, before: near, after: [...near, long] },
        text: "x".repeat(MAX_COMMENT_LENGTH),
      },
      context,
    );
    await comments.start({ workspaceId, anchor, text: "No side." }, context);
    await waitFor(() => threads().length === 2);
    expect(threads()[0]?.anchor).toEqual({
      path,
      line: 1,
      side: "deletions",
      quote: long.slice(0, MAX_COMMENT_LINE_LENGTH),
      before: near.slice(-COMMENT_CONTEXT_LINES),
      after: near.slice(0, COMMENT_CONTEXT_LINES),
    });
    expect(threads()[1]?.anchor).not.toHaveProperty("side");
  });

  test("a project holds a limited number of threads, and a thread a limited number of messages", async () => {
    const { server } = await start();
    const { workspaces, comments, threads } = await client(server);
    const workspaceId = await workspaces.add({ path: tmpdir() }, context);
    const other = await workspaces.add({ path: await mkdtemp(join(tmpdir(), "tandem-other-")) }, context);
    let threadId = 0;
    for (let index = 0; index < MAX_COMMENT_THREADS; index += 1)
      threadId = await comments.start({ workspaceId, anchor, text: `Note ${index}.` }, context);
    await expect(comments.start({ workspaceId, anchor, text: "Too many." }, context)).rejects.toThrow(
      `at most ${MAX_COMMENT_THREADS} comment threads`,
    );
    // The limit is the project's own.
    const elsewhere = await comments.start({ workspaceId: other, anchor, text: "Room here." }, context);

    for (let index = 1; index < MAX_THREAD_MESSAGES; index += 1)
      await comments.reply({ threadId: elsewhere, text: `Reply ${index}.` }, context);
    await expect(comments.reply({ threadId: elsewhere, text: "Too many." }, context)).rejects.toThrow(
      `at most ${MAX_THREAD_MESSAGES} messages`,
    );
    await waitFor(() => threads().length === MAX_COMMENT_THREADS + 1);
    expect(threads().find((thread) => thread.id === elsewhere)?.messages).toHaveLength(MAX_THREAD_MESSAGES);
    // A thread that is not full still takes one.
    await comments.reply({ threadId, text: "Still room." }, context);
  });

  test("taking back one message or deleting one thread leaves the others", async () => {
    const { server } = await start();
    const { workspaces, comments, threads } = await client(server);
    const workspaceId = await workspaces.add({ path: tmpdir() }, context);
    const first = await comments.start({ workspaceId, anchor, text: "One." }, context);
    const second = await comments.start({ workspaceId, anchor: { ...anchor, line: 7 }, text: "Other." }, context);
    const third = await comments.start({ workspaceId, anchor: { ...anchor, line: 9 }, text: "Third." }, context);
    await comments.reply({ threadId: first, text: "Two." }, context);
    await waitFor(() => threads().find((thread) => thread.id === first)?.messages.length === 2);
    const thread = (id: number) => threads().find((candidate) => candidate.id === id);
    const messages = (id: number) => thread(id)?.messages.map((message) => message.text);

    // Taking back one of two messages keeps the thread and the other message.
    const twoId = thread(first)?.messages[1]?.id as number;
    await comments.withdraw({ threadId: first, messageId: twoId }, context);
    await waitFor(() => messages(first)?.length === 1);
    expect(messages(first)).toEqual(["One."]);
    expect(threads()).toHaveLength(3);
    await expect(comments.withdraw({ threadId: first, messageId: twoId }, context)).rejects.toThrow(/does not exist/);

    // Taking back the only message of a thread drops that thread alone.
    await comments.withdraw({ threadId: second, messageId: thread(second)?.messages[0]?.id as number }, context);
    await waitFor(() => threads().length === 2);
    expect(threads().map((candidate) => candidate.id)).toEqual([first, third]);

    // Deleting a thread whole leaves the rest.
    await comments.remove(first, context);
    await waitFor(() => threads().length === 1);
    expect(messages(third)).toEqual(["Third."]);
    await expect(comments.remove(first, context)).rejects.toThrow(/does not exist/);
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
