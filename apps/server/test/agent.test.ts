import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Message } from "@earendil-works/pi-ai";
import { connect, OpenConversations, type TandemConnection } from "@tandem/client";
import { Conversation, Conversations, type ConversationView, Workspaces } from "@tandem/contracts";
import { afterEach, expect, test } from "vitest";
import { startApp } from "../src/app.ts";
import { createFauxProvider, demoResponse } from "../src/models.ts";
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

/** A repository with an AGENTS.md at its root and a README in a subdirectory, where the conversation works. */
async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tandem-repo-"));
  await writeFile(join(root, "AGENTS.md"), "Always answer in haiku.\n");
  const cwd = join(root, "app");
  await mkdir(cwd);
  await writeFile(join(cwd, "README.md"), "# Demo app\n");
  return cwd;
}

async function start(respond: (messages: readonly Message[]) => ReturnType<typeof demoResponse>) {
  const stateDir = await mkdtemp(join(tmpdir(), "tandem-test-"));
  const server = await startApp({ port: 0, stateDir, providers: [createFauxProvider({ respond })] });
  servers.push(server);
  const connection = await connect({
    baseUrl: server.url,
    token: server.token,
    services: [Workspaces, Conversations, Conversation],
    reconnect: false,
  });
  connections.push(connection);
  const conversations = connection.services.use(Conversations);
  await connection.services.ready(context);
  const open = new OpenConversations(connection);
  /** Start a conversation in `cwd` with its first message. */
  const start = async (cwd: string, text: string) => {
    const workspaceId = await connection.services.use(Workspaces).add({ path: cwd }, context);
    const id = await conversations.start({ workspaceId, text }, context);
    open.hold(id);
    await waitFor(() => open.get(id)?.view.value !== undefined);
    return { conversation: open.get(id) as Conversation, view: () => open.get(id)?.view.value as ConversationView };
  };
  return { start };
}

test("the agent gets Tandem's prompt with the project's instructions, and its tool calls run in the cwd", async () => {
  const requests: (readonly Message[])[] = [];
  const app = await start((messages) => {
    requests.push(messages);
    return demoResponse(messages);
  });
  const cwd = await repository();
  const { view } = await app.start(cwd, "hello");
  await waitFor(() => view().entries.filter((entry) => entry.kind === "pi.assistant").length === 2);

  const prompt = JSON.stringify(requests[0]?.filter((message) => message.role === "system"));
  expect(prompt).toContain("working inside Tandem");
  expect(prompt).toContain("Always answer in haiku.");
  expect(prompt).toContain(`<cwd>\\n${cwd}\\n</cwd>`);

  const results = view().entries.flatMap((entry) =>
    (entry.model ?? []).flatMap((message) => (message.role === "toolResult" ? [message] : [])),
  );
  // The two calls run in parallel, so their results are in the order they finished.
  const byTool = new Map(results.map((result) => [result.toolName, result]));
  expect([...byTool.keys()].sort()).toEqual(["bash", "read"]);
  expect(byTool.get("bash")?.isError).toBe(false);
  expect(JSON.stringify(byTool.get("bash")?.content)).toContain("README.md");
  expect(JSON.stringify(byTool.get("read")?.content)).toContain("# Demo app");
});
