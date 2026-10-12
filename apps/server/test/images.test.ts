import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ImageContent, Message } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { initSync, PhotonImage } from "@silvia-odwyer/photon/photon_rs.js";
import { connect, OpenConversations, type TandemConnection } from "@tandem/client";
import {
  Conversation,
  Conversations,
  type ConversationView,
  type ImageBlockRef,
  imagePath,
  Models,
  Workspaces,
} from "@tandem/contracts";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { startApp } from "../src/app.ts";
import { withoutData } from "../src/conversation-view.ts";
import { createFauxProvider, type FauxOptions } from "../src/models.ts";
import type { TandemServer } from "../src/server.ts";

const context = BACKGROUND_CONTEXT;
const servers: TandemServer[] = [];
const connections: TandemConnection[] = [];

beforeAll(() => {
  initSync({
    module: readFileSync(createRequire(import.meta.url).resolve("@silvia-odwyer/photon/photon_rs_bg.wasm")),
  });
});

afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A `width` by `height` PNG, red. */
function png(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index++) rgba.set([255, 0, 0, 255], index * 4);
  const image = new PhotonImage(rgba, width, height);
  try {
    return image.get_bytes();
  } finally {
    image.free();
  }
}

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

/** Every image block of the messages a model was sent, in order. */
function imagesOf(messages: readonly Message[]): ImageContent[] {
  return messages.flatMap((message) =>
    message.role === "assistant" || typeof message.content === "string"
      ? []
      : message.content.flatMap((block) => (block.type === "image" ? [block] : [])),
  );
}

async function start(faux: FauxOptions = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), "tandem-test-"));
  const requests: (readonly Message[])[] = [];
  const respond = faux.respond;
  const server = await startApp({
    port: 0,
    stateDir,
    providers: [
      createFauxProvider({
        ...faux,
        respond: (messages) => {
          requests.push(messages);
          return respond?.(messages) ?? fauxAssistantMessage("Seen.");
        },
      }),
    ],
  });
  servers.push(server);
  const connection = await connect({
    baseUrl: server.url,
    token: server.token,
    services: [Workspaces, Conversations, Conversation, Models],
    reconnect: false,
  });
  connections.push(connection);
  await connection.services.ready(context);
  const conversations = connection.services.use(Conversations);
  const open = new OpenConversations(connection);
  const cwd = await mkdtemp(join(tmpdir(), "tandem-repo-"));
  const workspaceId = await connection.services.use(Workspaces).add({ path: cwd }, context);
  const view = (id: number) => open.get(id)?.view.value as ConversationView | undefined;
  const opened = async (id: number) => {
    open.hold(id);
    await waitFor(() => view(id) !== undefined);
  };
  const fetchImage = (path: string, token = server.token) =>
    fetch(new URL(path, server.url), { headers: { authorization: `Bearer ${token}` } });
  return { server, connection, conversations, open, workspaceId, cwd, view, opened, requests, fetchImage };
}

/** The image blocks of a view, as a page receives them. */
function refsOf(view: ConversationView | undefined): ImageBlockRef[] {
  return (view?.entries ?? []).flatMap((entry) =>
    (entry.model ?? []).flatMap((message) =>
      message.role === "assistant" || typeof message.content === "string"
        ? []
        : message.content.flatMap((block) => (block.type === "image" ? [block as ImageBlockRef] : [])),
    ),
  );
}

describe("images in a message", () => {
  test("go to the model with the text, and reach pages as references they fetch", async () => {
    const app = await start();
    const image = png(40, 30);
    const id = await app.conversations.start(
      { workspaceId: app.workspaceId, text: "what is this?", images: [{ data: base64(image), mimeType: "image/png" }] },
      context,
    );
    await app.opened(id);
    await waitFor(() => app.requests.length === 1);
    const sent = app.requests[0] ?? [];
    expect(imagesOf(sent)).toEqual([{ type: "image", data: base64(image), mimeType: "image/png" }]);
    expect(JSON.stringify(sent.filter((message) => message.role === "user"))).toContain("what is this?");

    await waitFor(() => refsOf(app.view(id)).length === 1);
    expect(JSON.stringify(app.view(id))).not.toContain(base64(image));
    const [ref] = refsOf(app.view(id));
    expect(ref?.mimeType).toBe("image/png");
    expect(ref?.ref).toBeDefined();

    const response = await app.fetchImage(imagePath(ref?.ref as NonNullable<ImageBlockRef["ref"]>));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(image);
  });

  test("are fitted to the model's limits", async () => {
    const app = await start({
      models: [
        {
          id: "small-vision",
          input: ["text", "image"],
          inputLimits: { images: { resize: { maxWidth: 100, maxHeight: 100 } } },
        },
      ],
    });
    await app.conversations.start(
      { workspaceId: app.workspaceId, text: "", images: [{ data: base64(png(400, 200)), mimeType: "image/png" }] },
      context,
    );
    await waitFor(() => app.requests.length === 1);
    const [image] = imagesOf(app.requests[0] ?? []);
    const decoded = PhotonImage.new_from_byteslice(new Uint8Array(Buffer.from(image?.data ?? "", "base64")));
    try {
      expect([decoded.get_width(), decoded.get_height()]).toEqual([100, 50]);
    } finally {
      decoded.free();
    }
  });

  test("are sent with a message to an open conversation", async () => {
    const app = await start();
    const id = await app.conversations.start({ workspaceId: app.workspaceId, text: "hello" }, context);
    await app.opened(id);
    await waitFor(() => app.requests.length === 1);
    const conversation = app.open.get(id) as Conversation;
    await conversation.submit(
      { text: "", images: [{ data: base64(png(8, 8)), mimeType: "image/png" }], whenBusy: "followUp" },
      context,
    );
    await waitFor(() => app.requests.length === 2);
    expect(imagesOf(app.requests[1] ?? [])).toHaveLength(1);
    await waitFor(() => refsOf(app.view(id)).length === 1);
  });

  test("are refused when the model takes none, and the conversation is not created", async () => {
    const app = await start({ models: [{ id: "text-only", input: ["text"] }] });
    const models = app.connection.services.use(Models);
    await waitFor(() => (models.state.value?.models.length ?? 0) > 0);
    expect(models.state.value?.models[0]?.images).toBeUndefined();
    await expect(
      app.conversations.start(
        { workspaceId: app.workspaceId, text: "look", images: [{ data: base64(png(8, 8)), mimeType: "image/png" }] },
        context,
      ),
    ).rejects.toThrow(/does not take images/);
    expect(app.conversations.state.value?.conversations ?? []).toEqual([]);
  });

  test("are refused when they are not images, or more than the model takes", async () => {
    const app = await start({
      models: [{ id: "one-image", input: ["text", "image"], inputLimits: { images: { maxPerMessage: 1 } } }],
    });
    const models = app.connection.services.use(Models);
    await waitFor(() => (models.state.value?.models.length ?? 0) > 0);
    expect(models.state.value?.models[0]?.images).toEqual({ maxPerMessage: 1 });
    const one = { data: base64(png(8, 8)), mimeType: "image/png" };
    await expect(
      app.conversations.start({ workspaceId: app.workspaceId, text: "", images: [one, one] }, context),
    ).rejects.toThrow(/at most 1 images/);
    await expect(
      app.conversations.start(
        {
          workspaceId: app.workspaceId,
          text: "",
          images: [{ data: base64(new Uint8Array([1, 2, 3])), mimeType: "image/png" }],
        },
        context,
      ),
    ).rejects.toThrow(/not a PNG, JPEG, GIF, WebP, or BMP/);
  });
});

describe("the agent reading an image", () => {
  test("gets the image from read, which pages fetch like any other", async () => {
    const app = await start({
      respond: (messages) =>
        messages.at(-1)?.role === "toolResult"
          ? fauxAssistantMessage("A red square.")
          : fauxAssistantMessage([fauxText("Let me look."), fauxToolCall("read", { path: "shot.png" })], {
              stopReason: "toolUse",
            }),
    });
    const image = png(20, 20);
    await writeFile(join(app.cwd, "shot.png"), image);
    const id = await app.conversations.start({ workspaceId: app.workspaceId, text: "read shot.png" }, context);
    await app.opened(id);
    await waitFor(() => app.requests.length === 2);
    const result = (app.requests[1] ?? []).find((message) => message.role === "toolResult");
    expect(result?.isError).toBe(false);
    expect(imagesOf([result as Message])).toEqual([{ type: "image", data: base64(image), mimeType: "image/png" }]);
    expect(JSON.stringify(result?.content)).toContain("Read image file [image/png]");

    await waitFor(() => refsOf(app.view(id)).length === 1);
    const [ref] = refsOf(app.view(id));
    const response = await app.fetchImage(imagePath(ref?.ref as NonNullable<ImageBlockRef["ref"]>));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(image);
  });

  test("still reads text files as before", async () => {
    const app = await start({
      respond: (messages) =>
        messages.at(-1)?.role === "toolResult"
          ? fauxAssistantMessage("Done.")
          : fauxAssistantMessage([fauxToolCall("read", { path: "notes.txt" })], { stopReason: "toolUse" }),
    });
    await writeFile(join(app.cwd, "notes.txt"), "plain text\n");
    await app.conversations.start({ workspaceId: app.workspaceId, text: "read" }, context);
    await waitFor(() => app.requests.length === 2);
    const result = (app.requests[1] ?? []).find((message) => message.role === "toolResult");
    expect(JSON.stringify(result?.content)).toContain("plain text");
  });
});

describe("the image endpoint", () => {
  test("needs the token, and answers 404 for what is not an image", async () => {
    const app = await start();
    const id = await app.conversations.start(
      { workspaceId: app.workspaceId, text: "x", images: [{ data: base64(png(8, 8)), mimeType: "image/png" }] },
      context,
    );
    await app.opened(id);
    await waitFor(() => refsOf(app.view(id)).length === 1);
    const ref = refsOf(app.view(id))[0]?.ref as NonNullable<ImageBlockRef["ref"]>;
    expect((await app.fetchImage(imagePath(ref), "wrong")).status).toBe(401);
    expect((await fetch(new URL(imagePath(ref), app.server.url))).status).toBe(401);
    // The text block before the image, a message that is not there, an entry that is not there, a malformed path.
    expect((await app.fetchImage(imagePath({ ...ref, block: ref.block - 1 }))).status).toBe(404);
    expect((await app.fetchImage(imagePath({ ...ref, message: 9 }))).status).toBe(404);
    expect((await app.fetchImage(imagePath({ ...ref, entryId: 999_999 }))).status).toBe(404);
    expect((await app.fetchImage(imagePath({ ...ref, conversationId: 999_999 }))).status).toBe(404);
    expect((await app.fetchImage("/image/1/2/x/3")).status).toBe(404);
  });
});

describe("a view without image data", () => {
  test("keeps what holds no image as the same objects", () => {
    const text = { type: "text", text: "hi" };
    const entry = {
      model: [{ role: "user", content: [text, { type: "image", data: "AAAA", mimeType: "image/png" }] }],
    };
    const turned = withoutData(entry, [], (path) => ({
      conversationId: 1,
      entryId: 2,
      message: 0,
      block: path.length,
    }));
    expect(JSON.stringify(turned)).not.toContain("AAAA");
    const content = (turned as typeof entry).model[0]?.content;
    expect(content?.[0]).toBe(text);
    expect(content?.[1]).toEqual({
      type: "image",
      mimeType: "image/png",
      ref: { conversationId: 1, entryId: 2, message: 0, block: 4 },
    });
    const plain = { model: [{ role: "user", content: "hi" }] };
    expect(withoutData(plain, [])).toBe(plain);
  });
});
