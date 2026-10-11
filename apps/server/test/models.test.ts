import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Provider } from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai/models";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import { connect, OpenConversations, type TandemConnection } from "@tandem/client";
import { Conversation, Conversations, Models, type StartInput, Workspaces } from "@tandem/contracts";
import { afterEach, describe, expect, test } from "vitest";
import { startApp } from "../src/app.ts";
import { FileCredentialStore } from "../src/credentials.ts";
import { createFauxProvider } from "../src/models.ts";
import type { TandemServer } from "../src/server.ts";

const context = BACKGROUND_CONTEXT;
const servers: TandemServer[] = [];
const connections: TandemConnection[] = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

/** A provider whose OAuth login shows a URL and asks for a pasted code, and whose API-key login asks for a key. */
function loginProvider(id: string): Provider {
  const core = createFauxCore({ provider: id, models: [{ id: `${id}-model`, name: `${id} model` }] });
  return createProvider({
    id,
    name: `Provider ${id}`,
    auth: {
      oauth: {
        name: "Test account",
        async login(interaction) {
          interaction.notify({ type: "auth_url", url: "https://login.example/authorize" });
          const code = await interaction.prompt({ type: "manual_code", message: "Paste the code" });
          return { type: "oauth", access: code, refresh: "refresh", expires: Date.now() + 3_600_000 };
        },
        refresh: async (credential) => credential,
        toAuth: async (credential) => ({ apiKey: credential.access }),
      },
    },
    models: core.models,
    api: { stream: core.stream, streamSimple: core.streamSimple },
  });
}

async function start(providers: Provider[]) {
  const stateDir = await mkdtemp(join(tmpdir(), "tandem-test-"));
  const server = await startApp({ port: 0, stateDir, providers });
  servers.push(server);
  const connection = await connect({
    baseUrl: server.url,
    token: server.token,
    services: [Models, Workspaces, Conversations, Conversation],
    reconnect: false,
  });
  connections.push(connection);
  const models = connection.services.use(Models);
  const conversations = connection.services.use(Conversations);
  await connection.services.ready(context);
  /** Start a conversation in a project of the system's temporary directory. */
  const startIn = async (input: Omit<StartInput, "workspaceId">) =>
    conversations.start(
      { workspaceId: await connection.services.use(Workspaces).add({ path: tmpdir() }, context), ...input },
      context,
    );
  return { stateDir, connection, models, conversations, startIn };
}

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("FileCredentialStore", () => {
  test("serializes writes and keeps the file private", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "tandem-test-")), "auth.json");
    const store = new FileCredentialStore(path);
    // Each write reads the previous one, so a lost update would leave a lower count.
    await Promise.all(
      Array.from({ length: 20 }, () =>
        store.modify("counter", async (current) => ({
          type: "api_key",
          key: String(Number(current?.type === "api_key" ? current.key : 0) + 1),
        })),
      ),
    );
    expect(await store.read("counter")).toEqual({ type: "api_key", key: "20" });
    expect(await store.list()).toEqual([{ providerId: "counter", type: "api_key" }]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await store.delete("counter");
    expect(await store.read("counter")).toBeUndefined();
  });
});

describe("models", () => {
  test("an OAuth login runs on the server and the browser answers its prompt", async () => {
    const { stateDir, models } = await start([loginProvider("test")]);
    const provider = () => models.state.value?.providers.find((candidate) => candidate.id === "test");
    expect(provider()).toMatchObject({ login: [{ type: "oauth", label: "Test account" }], stored: false });
    expect(provider()?.configured).toBeUndefined();
    expect(models.state.value?.models).toEqual([]);

    await models.login({ providerId: "test", type: "oauth" }, context);
    await waitFor(() => models.state.value?.login?.prompt !== undefined);
    const login = models.state.value?.login;
    expect(login).toMatchObject({
      providerId: "test",
      status: "running",
      events: [{ type: "auth_url", url: "https://login.example/authorize" }],
      prompt: { type: "manual_code", message: "Paste the code" },
    });

    await models.answerLogin({ promptId: login?.prompt?.id ?? -1, value: "secret-code" }, context);
    await waitFor(() => models.state.value?.login?.status === "succeeded");
    expect(provider()).toMatchObject({ stored: true, configured: { type: "oauth" } });
    expect(models.state.value?.models.map((model) => model.modelId)).toEqual(["test-model"]);
    // The credential stays on the server.
    expect(JSON.stringify(models.state.value)).not.toContain("secret-code");
    expect(JSON.parse(await readFile(join(stateDir, "auth.json"), "utf8")).test.access).toBe("secret-code");

    await models.logout("test", context);
    await waitFor(() => provider()?.stored === false);
    expect(models.state.value?.models).toEqual([]);
  });

  test("a cancelled login stores nothing", async () => {
    const { models } = await start([loginProvider("test")]);
    await models.login({ providerId: "test", type: "oauth" }, context);
    await waitFor(() => models.state.value?.login?.prompt !== undefined);
    await models.cancelLogin(context);
    await waitFor(() => models.state.value?.login?.status === "cancelled");
    expect(models.state.value?.login?.prompt).toBeUndefined();
    expect(models.state.value?.providers.find((provider) => provider.id === "test")?.stored).toBe(false);
  });

  test("new conversations start with the default model or the chosen one, and a conversation can switch", async () => {
    const { models, startIn, connection } = await start([createFauxProvider(), loginProvider("other")]);
    await models.login({ providerId: "other", type: "oauth" }, context);
    await waitFor(() => models.state.value?.login?.prompt !== undefined);
    await models.answerLogin({ promptId: models.state.value?.login?.prompt?.id ?? -1, value: "code" }, context);
    await waitFor(() => models.state.value?.models.length === 2);

    await models.setDefaultModel({ provider: "other", modelId: "other-model" }, context);
    await waitFor(() => models.state.value?.defaultModel?.provider === "other");
    const open = new OpenConversations(connection);
    const id = await startIn({ text: "hello" });
    open.hold(id);
    await waitFor(() => open.get(id)?.view.value !== undefined);
    const agent = () => open.get(id)?.view.value?.docs["pi.agent"] as { model?: { provider: string } } | undefined;
    expect(agent()?.model?.provider).toBe("other");

    const chosen = await startIn({
      text: "hello",
      model: { provider: "faux", modelId: "faux-1" },
      thinkingLevel: "high",
    });
    open.hold(chosen);
    await waitFor(() => open.get(chosen)?.view.value !== undefined);
    expect(open.get(chosen)?.view.value?.docs["pi.agent"]).toMatchObject({ model: { provider: "faux" } });

    await open.get(id)?.configure({ model: { provider: "faux", modelId: "faux-1" } }, context);
    await waitFor(() => agent()?.model?.provider === "faux");
    await expect(open.get(id)?.configure({ model: { provider: "nope", modelId: "x" } }, context)).rejects.toThrow(
      "not available",
    );
  });

  test("a message without a model gets a notice instead of an answer", async () => {
    const { startIn, connection } = await start([loginProvider("test")]);
    const open = new OpenConversations(connection);
    const id = await startIn({ text: "hello" });
    open.hold(id);
    await waitFor(() => open.get(id)?.view.value !== undefined);
    await waitFor(() => (open.get(id)?.notices.value?.notices.length ?? 0) > 0);
    expect(open.get(id)?.notices.value?.notices[0]?.message).toContain("No model is selected");
  });
});
