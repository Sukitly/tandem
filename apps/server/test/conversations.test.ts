import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { LiveState } from "@earendil-works/pi-durable";
import { connect, OpenConversations, type TandemConnection } from "@tandem/client";
import { Conversation, Conversations, type ConversationView, Workspaces } from "@tandem/contracts";
import { afterEach, describe, expect, test } from "vitest";
import { type StartAppOptions, startApp } from "../src/app.ts";
import { FileCredentialStore } from "../src/credentials.ts";
import { openHarness } from "../src/harness.ts";
import { createAppModels, createFauxProvider } from "../src/models.ts";
import type { TandemServer } from "../src/server.ts";
import { ConversationMetaDoc } from "../src/services/conversations.ts";
import { openStateDir } from "../src/state-dir.ts";

const context = BACKGROUND_CONTEXT;
const servers = new Set<TandemServer>();
const connections: TandemConnection[] = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
  await Promise.all([...servers].map((server) => stopApp(server)));
});

async function start(options: StartAppOptions = {}) {
  const stateDir = options.stateDir ?? (await mkdtemp(join(tmpdir(), "tandem-test-")));
  const server = await startApp({ port: 0, providers: [createFauxProvider()], ...options, stateDir });
  servers.add(server);
  return { server, stateDir };
}

async function stopApp(server: TandemServer): Promise<void> {
  servers.delete(server);
  await server.stop();
}

/** A client with the conversation list and the conversations it opened, by ID. */
async function client(server: TandemServer) {
  const connection = await connect({
    baseUrl: server.url,
    token: server.token,
    services: [Workspaces, Conversations, Conversation],
    reconnect: { initialDelayMs: 20, maxDelayMs: 100 },
  });
  connections.push(connection);
  const workspaces = connection.services.use(Workspaces);
  const conversations = connection.services.use(Conversations);
  /** Add a directory as a project; the system's temporary directory by default. */
  const project = (path: string = tmpdir()) => workspaces.add({ path }, context);
  /** Start a conversation with its first message; in a project of the system's temporary directory by default. */
  const startIn = async (text: string, workspaceId?: number) =>
    conversations.start({ workspaceId: workspaceId ?? (await project()), text }, context);
  const open = new Map<number, Conversation>();
  const observed: number[] = [];
  connection.services.observe(Conversation, async (instance, instanceContext: Context) => {
    await waitFor(() => instance.view.value !== undefined);
    const id = instance.view.value?.conversation.id ?? -1;
    observed.push(id);
    open.set(id, instance);
    instanceContext.abortSignal?.addEventListener("abort", () => {
      if (open.get(id) === instance) open.delete(id);
    });
  });
  await connection.services.ready(context);
  /**
   * Open a conversation and wait for its instance. The instance is wrapped: service handles accept any member name,
   * `then` included, so awaiting one would call it as a remote method.
   */
  const openConversation = async (id: number): Promise<{ conversation: Conversation }> => {
    await conversations.open(id, context);
    await waitFor(() => open.has(id));
    return { conversation: open.get(id) as Conversation };
  };
  const view = (id: number) => open.get(id)?.view.value;
  return { connection, workspaces, conversations, project, startIn, open, observed, openConversation, view };
}

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The text of every answer, and why it ended. */
function replies(view: ConversationView | undefined): { text: string; stopReason: string }[] {
  return (view?.entries ?? []).flatMap((entry) =>
    (entry.model ?? []).flatMap((message) =>
      message.role === "assistant"
        ? [
            {
              text: message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
              stopReason: message.stopReason,
            },
          ]
        : [],
    ),
  );
}

function answers(view: ConversationView | undefined): string[] {
  return replies(view).map((reply) => reply.text);
}

function isBusy(view: ConversationView | undefined): boolean {
  return view?.docs["pi.live"]?.run !== undefined;
}

describe("conversations", () => {
  test("a conversation starts with its first message, and later messages are answered in its view", async () => {
    const { server } = await start();
    const { conversations, startIn, openConversation, view } = await client(server);

    const id = await startIn("hello");
    expect(conversations.state.value?.conversations[0]).toMatchObject({ id, title: "hello" });
    const { conversation } = await openConversation(id);
    await waitFor(() => answers(view(id)).includes("You said: hello") && !isBusy(view(id)));

    await conversation.submit({ text: "again", whenBusy: "followUp" }, context);
    await waitFor(() => answers(view(id)).includes("You said: again"));
    expect(conversations.state.value?.conversations[0]?.title).toBe("hello");
  });

  test("two clients see the same list and the same conversation", async () => {
    const { server } = await start();
    const first = await client(server);
    const second = await client(server);

    const id = await first.startIn("from the first");
    await waitFor(() => second.conversations.state.value?.conversations.some((summary) => summary.id === id) ?? false);
    await first.openConversation(id);
    const { conversation } = await second.openConversation(id);

    await conversation.submit({ text: "from the second", whenBusy: "followUp" }, context);
    await waitFor(() => answers(first.view(id)).includes("You said: from the second"));
    await waitFor(() => !isBusy(first.view(id)) && !isBusy(second.view(id)));
    expect(first.view(id)).toEqual(second.view(id));
  });

  test("a client receives only the conversations it opened", async () => {
    const { server } = await start();
    const first = await client(server);
    const second = await client(server);
    const a = await first.startIn("for a");
    const b = await first.startIn("for b");

    await first.openConversation(a);
    const { conversation } = await second.openConversation(b);
    await waitFor(() => answers(second.view(b)).length === 1 && !isBusy(second.view(b)));
    await conversation.submit({ text: "only for b", whenBusy: "followUp" }, context);
    await waitFor(() => answers(second.view(b)).length === 2);
    expect(first.observed).toEqual([a]);
    expect(second.observed).toEqual([b]);

    await first.conversations.close(a, context);
    await waitFor(() => !first.open.has(a));
  });

  test("rejects invalid input", async () => {
    const { server } = await start();
    const { workspaces, conversations, project, startIn, openConversation } = await client(server);
    await expect(workspaces.add({ path: "relative/path" }, context)).rejects.toThrow("absolute");
    await expect(workspaces.add({ path: join(tmpdir(), "does-not-exist-tandem") }, context)).rejects.toThrow(
      "Not a directory",
    );
    await expect(workspaces.remove(999, context)).rejects.toThrow("does not exist");
    await expect(conversations.start({ workspaceId: 999, text: "hi" }, context)).rejects.toThrow("does not exist");
    await expect(conversations.open(999, context)).rejects.toThrow("does not exist");
    const workspaceId = await project();
    await expect(conversations.start({ workspaceId, text: " " }, context)).rejects.toThrow("non-empty");
    await expect(
      conversations.start({ workspaceId, text: "hi", model: { provider: "nope", modelId: "x" } }, context),
    ).rejects.toThrow("not available");
    // A refused start leaves no conversation behind.
    expect(conversations.state.value?.conversations).toEqual([]);

    const { conversation } = await openConversation(await startIn("hi", workspaceId));
    await expect(conversation.submit({ text: " ", whenBusy: "followUp" }, context)).rejects.toThrow("non-empty");
  });

  test("an answer interrupted by a restart completes, and the open client picks it up", async () => {
    const reply = (text: string) => `${text}: ${"word ".repeat(200).trim()}`;
    const slow = await start({ providers: [createFauxProvider({ tokensPerSecond: 50, reply })] });
    const user = await client(slow.server);
    const id = await user.startIn("long");
    const held = new OpenConversations(user.connection);
    held.hold(id);
    await waitFor(() => held.get(id) !== undefined);
    // Stop while the answer is streaming.
    await waitFor(
      () => (held.get(id)?.view.value?.docs["pi.live"] as LiveState | undefined)?.generation?.message !== undefined,
    );
    await stopApp(slow.server);
    await waitFor(() => user.connection.status.value?.status === "disconnected" && held.get(id) === undefined);

    // Same directory and port: the identity and token are read back, so the client reconnects by itself.
    await start({
      stateDir: slow.stateDir,
      port: Number(slow.server.url.port),
      providers: [createFauxProvider({ reply })],
    });
    await waitFor(() => user.connection.status.value?.status === "connected", 5_000);
    expect(user.conversations.state.value?.conversations.map((summary) => summary.title)).toEqual(["long"]);

    // Instances belong to a connection: the conversation the client holds is opened again on the new one.
    await waitFor(() => answers(held.get(id)?.view.value).includes(reply("long")) && !isBusy(held.get(id)?.view.value));
    // The interrupted attempt stays in the transcript as an aborted answer; a new attempt answers in full.
    const [interrupted, completed] = replies(held.get(id)?.view.value);
    expect(interrupted?.stopReason).toBe("aborted");
    expect(reply("long").startsWith(interrupted?.text ?? "")).toBe(true);
    expect(completed).toEqual({ text: reply("long"), stopReason: "stop" });
  });

  test("projects are added, listed, and removed; removing hides their conversations until added again", async () => {
    const { server } = await start();
    const { workspaces, conversations, project, startIn } = await client(server);
    const pathA = await mkdtemp(join(tmpdir(), "tandem-a-"));
    const pathB = await mkdtemp(join(tmpdir(), "tandem-b-"));
    const a = await project(pathA);
    expect(await project(`${pathA}/`)).toBe(a);
    const b = await project(pathB);
    expect(workspaces.state.value?.workspaces).toEqual([
      { id: a, path: pathA, name: basename(pathA) },
      { id: b, path: pathB, name: basename(pathB) },
    ]);

    const inA = await startIn("in a", a);
    const inB = await startIn("in b", b);
    expect(conversations.state.value?.conversations.find((summary) => summary.id === inA)).toMatchObject({
      workspaceId: a,
      cwd: pathA,
      title: "in a",
    });

    await workspaces.remove(a, context);
    await waitFor(() => workspaces.state.value?.workspaces.length === 1);
    expect(conversations.state.value?.conversations.map((summary) => summary.id)).toEqual([inB]);
    await expect(conversations.open(inA, context)).rejects.toThrow("does not exist");
    await expect(conversations.start({ workspaceId: a, text: "hi" }, context)).rejects.toThrow("does not exist");

    expect(await project(pathA)).toBe(a);
    await waitFor(() => conversations.state.value?.conversations.length === 2);
  });

  test("the list is ordered by the last message, and shows which conversations are running", async () => {
    const slow = { providers: [createFauxProvider({ tokensPerSecond: 50, reply: () => "word ".repeat(40) })] };
    const { server } = await start(slow);
    const { conversations, startIn, openConversation } = await client(server);
    const ids = () => conversations.state.value?.conversations.map((summary) => summary.id);
    const running = (id: number) =>
      conversations.state.value?.conversations.find((summary) => summary.id === id)?.running;
    const first = await startIn("one");
    await waitFor(() => running(first) === true);
    await waitFor(() => running(first) === false, 5_000);
    const second = await startIn("two");
    await waitFor(() => running(second) === false, 5_000);
    expect(ids()).toEqual([second, first]);

    const { conversation } = await openConversation(first);
    await conversation.submit({ text: "go", whenBusy: "followUp" }, context);
    await waitFor(() => ids()?.[0] === first && running(first) === true);
    await waitFor(() => running(first) === false, 5_000);
  });

  test("conversations created before projects existed get a project per directory; ones never sent to stay out", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "tandem-test-"));
    const pathA = await mkdtemp(join(tmpdir(), "tandem-a-"));
    const pathB = await mkdtemp(join(tmpdir(), "tandem-b-"));
    const pathC = await mkdtemp(join(tmpdir(), "tandem-c-"));
    const models = createAppModels(new FileCredentialStore(join(stateDir, "auth.json")), [createFauxProvider()]);
    const opened = await openHarness({ databasePath: join(stateDir, "app.sqlite"), models }, context);
    // Conversations used to be created before their first message, and titled after it.
    for (const [cwd, createdAt, title] of [
      [pathA, 1, "one"],
      [pathB, 2, "two"],
      [pathA, 3, "three"],
      [pathC, 4, undefined],
    ] as const) {
      await opened.harness.createConversation(
        {
          ownership: { kind: "ownerless" },
          agent: { cwd },
          init: async (tx, id) => {
            const meta = await tx.doc(ConversationMetaDoc, id);
            meta.createdAt = createdAt;
            if (title !== undefined) meta.title = title;
          },
        },
        context,
      );
    }
    await opened.close(context);

    const { server } = await start({ stateDir });
    const { workspaces, conversations } = await client(server);
    const listed = workspaces.state.value?.workspaces ?? [];
    expect(listed.map((workspace) => workspace.path).sort()).toEqual([pathA, pathB].sort());
    const workspaceOf = (path: string) => listed.find((workspace) => workspace.path === path)?.id;
    expect(conversations.state.value?.conversations.map((summary) => [summary.updatedAt, summary.workspaceId])).toEqual(
      [
        [3, workspaceOf(pathA)],
        [2, workspaceOf(pathB)],
        [1, workspaceOf(pathA)],
      ],
    );
  });

  test("one server per state directory", async () => {
    const { stateDir } = await start();
    await expect(openStateDir(stateDir, { lockRetries: 0 })).rejects.toThrow("Another Tandem server");
  });
});
