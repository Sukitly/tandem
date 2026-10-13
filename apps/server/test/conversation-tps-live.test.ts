import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { connect, OpenConversations, type TandemConnection } from "@tandem/client";
import { Conversation, Conversations, Workspaces } from "@tandem/contracts";
import { afterEach, expect, test } from "vitest";
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

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const usage = {
  input: 10,
  output: 5,
  cacheRead: 80,
  cacheWrite: 10,
  totalTokens: 105,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

test("the client receives the last run's tps", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "tandem-test-"));
  const server = await startApp({
    port: 0,
    stateDir,
    providers: [createFauxProvider({ respond: (messages: readonly Message[]): AssistantMessage => answer(messages) })],
  });
  servers.push(server);
  const connection = await connect({
    baseUrl: server.url,
    token: server.token,
    services: [Workspaces, Conversations, Conversation],
    reconnect: false,
  });
  connections.push(connection);
  await connection.services.ready(context);
  const open = new OpenConversations(connection);
  const conversation = await connection.services.use(Workspaces).add({ path: stateDir }, context);
  const id = await connection.services.use(Conversations).start({ workspaceId: conversation, text: "hi" }, context);
  open.hold(id);
  await waitFor(() => open.get(id)?.view.value !== undefined);
  // Let the first run finish, so the run measured next is one the tracker sees from its start to its end.
  await waitFor(() => !isBusy(open.get(id)?.view.value));
  await open.get(id)?.submit({ text: "again", whenBusy: "followUp" }, context);
  await waitFor(() => (open.get(id)?.tps.value?.last?.seconds ?? 0) > 0);
  const last = open.get(id)?.tps.value?.last;
  expect(last).toMatchObject({
    tokensPerSecond: expect.any(Number),
    outputTokens: expect.any(Number),
    totalTokens: expect.any(Number),
    seconds: expect.any(Number),
  });
  expect(last?.outputTokens).toBeGreaterThan(0);
});

function isBusy(view: { docs?: Record<string, unknown> } | undefined): boolean {
  return (view?.docs?.["pi.live"] as { run?: unknown } | undefined)?.run !== undefined;
}

function answer(_messages: readonly Message[]): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "hello" }],
    api: "faux",
    provider: "faux",
    model: "faux",
    usage,
    stopReason: "stop",
    timestamp: Date.now(),
  } as unknown as AssistantMessage;
}
