import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { connect, type TandemConnection } from "@tandem/client";
import { type TerminalEvent, type TerminalSummary, Terminals, terminalPath, Workspaces } from "@tandem/contracts";
import { afterEach, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { startApp } from "../src/app.ts";
import { createFauxProvider } from "../src/models.ts";
import type { TandemServer } from "../src/server.ts";

const context = BACKGROUND_CONTEXT;
const servers: TandemServer[] = [];
const connections: TandemConnection[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
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

/** A plain shell without the user's profile, so that its output is the same everywhere. */
const SHELL = ["/bin/sh"];

async function start() {
  const stateDir = await mkdtemp(join(tmpdir(), "tandem-test-"));
  const server = await startApp({ port: 0, stateDir, providers: [createFauxProvider()], terminalCommand: SHELL });
  servers.push(server);
  const connection = await connect({ baseUrl: server.url, token: server.token, services: [Workspaces, Terminals] });
  connections.push(connection);
  await connection.services.ready(context);
  const workspaces = connection.services.use(Workspaces);
  const terminals = connection.services.use(Terminals);
  const cwd = await mkdtemp(join(tmpdir(), "tandem-project-"));
  const workspaceId = await workspaces.add({ path: cwd }, context);
  const list = (): TerminalSummary[] => terminals.state.value?.terminals ?? [];
  return { server, workspaces, terminals, workspaceId, cwd, list };
}

/** A page's end of a terminal: what it was sent, as text and events. */
interface Page {
  socket: WebSocket;
  /** The output after the screen, decoded. */
  output(): string;
  events: TerminalEvent[];
  send(text: string): void;
  resize(cols: number, rows: number): void;
}

async function openPage(server: TandemServer, id: string, headers: Record<string, string> = {}): Promise<Page> {
  const url = new URL(terminalPath(id), server.url);
  url.protocol = "ws:";
  url.searchParams.set("token", server.token);
  const socket = new WebSocket(url, { headers });
  sockets.push(socket);
  const chunks: Buffer[] = [];
  const events: TerminalEvent[] = [];
  socket.on("message", (data, isBinary) => {
    if (isBinary) chunks.push(data as Buffer);
    else events.push(JSON.parse(String(data)) as TerminalEvent);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return {
    socket,
    output: () => Buffer.concat(chunks).toString("utf8"),
    events,
    send: (text) => socket.send(Buffer.from(text), { binary: true }),
    resize: (cols, rows) => socket.send(JSON.stringify({ type: "resize", cols, rows })),
  };
}

/** The status of a refused upgrade. */
async function refused(server: TandemServer, path: string, token: string, origin?: string): Promise<number> {
  const url = new URL(path, server.url);
  url.protocol = "ws:";
  url.searchParams.set("token", token);
  const socket = new WebSocket(url, origin === undefined ? {} : { headers: { origin } });
  sockets.push(socket);
  // A refused socket reports an error too; the status is what is asked for.
  socket.on("error", () => {});
  return new Promise((resolve) => {
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    socket.once("open", () => resolve(101));
  });
}

describe("terminals", () => {
  test("run a shell in the project's directory: input, output, and its exit code", async () => {
    const { server, terminals, workspaceId, cwd, list } = await start();
    const id = await terminals.create({ workspaceId, cols: 80, rows: 24 }, context);
    await waitFor(() => list().length === 1);
    expect(list()[0]).toMatchObject({ id, workspaceId, title: "Terminal 1" });

    const page = await openPage(server, id);
    await waitFor(() => page.events.some((event) => event.type === "screen"));
    page.send("pwd\r");
    await waitFor(() => page.output().includes(cwd.split("/").at(-1) as string));
    page.send("exit 3\r");
    await waitFor(() => list()[0]?.exit !== undefined);
    expect(list()[0]?.exit).toEqual({ code: 3 });
    await waitFor(() => page.events.some((event) => event.type === "exit"));
    expect(page.events.find((event) => event.type === "exit")).toEqual({ type: "exit", code: 3 });
  });

  test("take the newest size, and tell every page", async () => {
    const { server, terminals, workspaceId } = await start();
    const id = await terminals.create({ workspaceId, cols: 80, rows: 24 }, context);
    const a = await openPage(server, id);
    const b = await openPage(server, id);
    await waitFor(() => a.events.length > 0 && b.events.length > 0);
    a.resize(120, 40);
    await waitFor(() => b.events.some((event) => event.type === "resize"));
    expect(b.events.find((event) => event.type === "resize")).toEqual({ type: "resize", cols: 120, rows: 40 });
    a.send("stty size\r");
    await waitFor(() => a.output().includes("40 120"));
  });

  test("Ctrl-C interrupts what runs in it", async () => {
    const { server, terminals, workspaceId } = await start();
    const id = await terminals.create({ workspaceId, cols: 80, rows: 24 }, context);
    const page = await openPage(server, id);
    await waitFor(() => page.events.length > 0);
    page.send("sleep 30\r");
    await new Promise((resolve) => setTimeout(resolve, 300));
    page.send("\x03");
    // The shell answers again long before the 30 seconds are up: the sleep was interrupted. The sum is computed, so
    // the echoed command line does not contain it.
    page.send("echo after-$((40+2))\r");
    await waitFor(() => page.output().includes("after-42"));
  });

  test("a page that connects later is sent the screen as it is", async () => {
    const { server, terminals, workspaceId } = await start();
    const id = await terminals.create({ workspaceId, cols: 80, rows: 24 }, context);
    const first = await openPage(server, id);
    await waitFor(() => first.events.length > 0);
    first.send("echo one-$((1+1)); printf '\\033[31mred\\033[0m\\n'\r");
    await waitFor(() => first.output().includes("one-2"));
    first.socket.close();

    const later = await openPage(server, id);
    await waitFor(() => later.events.some((event) => event.type === "screen"));
    const screen = later.events.find((event) => event.type === "screen");
    expect(screen).toMatchObject({ cols: 80, rows: 24 });
    expect(screen?.type === "screen" ? screen.data : "").toContain("one-2");
    expect(screen?.type === "screen" ? screen.data : "").toContain("\x1b[31mred");
    // Then what follows it, live.
    later.send("echo two-$((1+1))\r");
    await waitFor(() => later.output().includes("two-2"));
  });

  test("are closed by the user, and with their project", async () => {
    const { workspaces, terminals, workspaceId, list } = await start();
    const first = await terminals.create({ workspaceId, cols: 80, rows: 24 }, context);
    await terminals.create({ workspaceId, cols: 80, rows: 24 }, context);
    await waitFor(() => list().length === 2);
    expect(list().map((summary) => summary.title)).toEqual(["Terminal 1", "Terminal 2"]);
    await terminals.close(first, context);
    await waitFor(() => list().length === 1);
    await workspaces.remove(workspaceId, context);
    await waitFor(() => list().length === 0);
  });

  test("refuse what they cannot do", async () => {
    const { terminals, workspaceId } = await start();
    await expect(terminals.create({ workspaceId: 999, cols: 80, rows: 24 }, context)).rejects.toThrow(/does not exist/);
    await expect(
      terminals.create(
        { workspaceId, cols: 1.5, rows: 24 } as unknown as { workspaceId: number; cols: number; rows: number },
        context,
      ),
    ).rejects.toThrow(/integers/);
    for (let index = 0; index < 10; index += 1) await terminals.create({ workspaceId, cols: 80, rows: 24 }, context);
    await expect(terminals.create({ workspaceId, cols: 80, rows: 24 }, context)).rejects.toThrow(/at most 10/);
    await expect(terminals.close("nope", context)).rejects.toThrow(/does not exist/);
  });

  test("connect only with the token, from an allowed origin, to a terminal that exists", async () => {
    const { server, terminals, workspaceId } = await start();
    const id = await terminals.create({ workspaceId, cols: 80, rows: 24 }, context);
    expect(await refused(server, terminalPath(id), "wrong")).toBe(401);
    expect(await refused(server, terminalPath(id), server.token, "https://evil.example")).toBe(403);
    expect(await refused(server, terminalPath("nope"), server.token)).toBe(404);
    expect(await refused(server, terminalPath(id), server.token, server.url.origin)).toBe(101);
  });
});
