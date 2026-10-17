import { mkdtemp, realpath, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { connect, type TandemConnection, type TerminalConnection, type TerminalLink } from "@tandem/client";
import { type TerminalSummary, Terminals, terminalPath, Workspaces } from "@tandem/contracts";
import { afterEach, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { startApp } from "../src/app.ts";
import { createFauxProvider } from "../src/models.ts";
import type { TandemServer } from "../src/server.ts";

const context = BACKGROUND_CONTEXT;
const servers: TandemServer[] = [];
const connections: TandemConnection[] = [];
const pages: TerminalConnection[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const page of pages.splice(0)) page.close();
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

async function start(terminalCommand: readonly string[] = SHELL) {
  const stateDir = await mkdtemp(join(tmpdir(), "tandem-test-"));
  const server = await startApp({ port: 0, stateDir, providers: [createFauxProvider()], terminalCommand });
  servers.push(server);
  const connection = await connect({ baseUrl: server.url, token: server.token, services: [Workspaces, Terminals] });
  connections.push(connection);
  await connection.services.ready(context);
  const workspaces = connection.services.use(Workspaces);
  const terminals = connection.services.use(Terminals);
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "tandem-project-")));
  const workspaceId = await workspaces.add({ path: cwd }, context);
  const list = (): TerminalSummary[] => terminals.state.value?.terminals ?? [];
  /** A page showing a terminal, through the same client the web app uses; its screen records what it is sent. */
  const open = (id: string) => {
    const screens: string[] = [];
    const sizes: string[] = [];
    const output: string[] = [];
    const links: TerminalLink[] = [];
    const page = connection.terminal(
      id,
      {
        write: (data) => output.push(typeof data === "string" ? data : new TextDecoder().decode(data)),
        reset: () => {
          screens.push("");
          output.length = 0;
        },
        resize: (cols, rows) => sizes.push(`${cols}x${rows}`),
      },
      { onLink: (link) => links.push(link) },
    );
    pages.push(page);
    return {
      page,
      links,
      sizes,
      /** What the page shows since its last screen: the screen's text, then the output after it. */
      shown: () => output.join(""),
      screens: () => screens.length,
    };
  };
  return { server, workspaces, terminals, workspaceId, cwd, list, open };
}

/** The status of a refused upgrade; a browser's WebSocket cannot see it, so this one is `ws`'s. */
async function refused(server: TandemServer, path: string, token: string, origin?: string): Promise<number> {
  const url = new URL(path, server.url);
  url.protocol = "ws:";
  const socket = new WebSocket(url, {
    headers: { authorization: `Bearer ${token}`, ...(origin === undefined ? {} : { origin }) },
  });
  sockets.push(socket);
  // A refused socket reports an error too; the status is what is asked for.
  socket.on("error", () => {});
  return new Promise((resolve) => {
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    socket.once("open", () => resolve(101));
  });
}

describe("a terminal", () => {
  test("answers application pings on the same socket and rejects malformed ping IDs", async () => {
    const { server, terminals, workspaceId } = await start();
    const id = await terminals.create({ workspaceId }, context);
    const url = new URL(terminalPath(id), server.url);
    url.protocol = "ws:";
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${server.token}` } });
    sockets.push(socket);
    const events: unknown[] = [];
    let closeCode: number | undefined;
    socket.on("message", (data, binary) => {
      if (!binary) events.push(JSON.parse(data.toString()));
    });
    socket.on("close", (code) => {
      closeCode = code;
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({ type: "ping", id: 7 }));
    await waitFor(() => events.some((event) => JSON.stringify(event) === JSON.stringify({ type: "pong", id: 7 })));
    socket.send(JSON.stringify({ type: "ping", id: "invalid" }));
    await waitFor(() => closeCode !== undefined);
    expect(closeCode).toBe(1003);
  });
  test("runs a shell in the project's directory, and lists its exit code", async () => {
    const { terminals, workspaceId, cwd, list, open } = await start();
    const id = await terminals.create({ workspaceId }, context);
    await waitFor(() => list().length === 1);
    expect(list()[0]).toMatchObject({ id, workspaceId, title: "Terminal 1" });

    const { page, screens, shown } = open(id);
    await waitFor(() => screens() === 1);
    page.input("pwd\r");
    await waitFor(() => shown().includes(cwd));
    page.input("exit 3\r");
    await waitFor(() => list()[0]?.exit !== undefined);
    expect(list()[0]?.exit).toEqual({ code: 3 });
  });

  test("lists the signal that ended its shell", async () => {
    const { terminals, workspaceId, list, open } = await start();
    const id = await terminals.create({ workspaceId }, context);
    const { page, screens } = open(id);
    await waitFor(() => screens() === 1);
    page.input("kill -9 $$\r");
    await waitFor(() => list()[0]?.exit !== undefined);
    expect(list()[0]?.exit).toEqual({ code: 0, signal: 9 });
  });

  test("starts at the default size, and takes the newest size a page sends, telling every page", async () => {
    const { terminals, workspaceId, open } = await start();
    const id = await terminals.create({ workspaceId }, context);
    const a = open(id);
    const b = open(id);
    await waitFor(() => a.screens() === 1 && b.screens() === 1);
    expect(b.sizes).toEqual(["80x24"]);
    a.page.resize({ cols: 120, rows: 40 });
    await waitFor(() => b.sizes.includes("120x40"));
    a.page.input("stty size\r");
    await waitFor(() => a.shown().includes("40 120"));
  });

  test("is interrupted by Ctrl-C", async () => {
    const { terminals, workspaceId, open } = await start();
    const id = await terminals.create({ workspaceId }, context);
    const { page, screens, shown } = open(id);
    await waitFor(() => screens() === 1);
    page.input("sleep 30\r");
    await new Promise((resolve) => setTimeout(resolve, 300));
    page.input("\x03");
    // The shell answers again long before the 30 seconds are up: the sleep was interrupted. The sum is computed, so
    // the echoed command line does not contain it.
    page.input("echo after-$((40+2))\r");
    await waitFor(() => shown().includes("after-42"));
  });

  test("sends a page that connects later the screen as it is, then the output after it", async () => {
    const { terminals, workspaceId, open } = await start();
    const id = await terminals.create({ workspaceId }, context);
    const first = open(id);
    await waitFor(() => first.screens() === 1);
    first.page.input("echo one-$((1+1)); printf '\\033[31mred\\033[0m\\n'\r");
    await waitFor(() => first.shown().includes("one-2"));
    first.page.close();

    const later = open(id);
    await waitFor(() => later.screens() === 1 && later.shown().includes("one-2"));
    expect(later.shown()).toContain("\x1b[31mred");
    later.page.input("echo two-$((1+1))\r");
    await waitFor(() => later.shown().includes("two-2"));
  });

  test("with a program that cannot run ends at once with exit code 1", async () => {
    const { terminals, workspaceId, list } = await start(["/nonexistent/program"]);
    await terminals.create({ workspaceId }, context);
    await waitFor(() => list()[0]?.exit !== undefined);
    expect(list()[0]?.exit).toEqual({ code: 1 });
  });
});

describe("closing terminals", () => {
  test("the user closes one, and its pages are closed", async () => {
    const { terminals, workspaceId, list, open } = await start();
    const first = await terminals.create({ workspaceId }, context);
    await terminals.create({ workspaceId }, context);
    await waitFor(() => list().length === 2);
    expect(list().map((summary) => summary.title)).toEqual(["Terminal 1", "Terminal 2"]);
    const { links, screens } = open(first);
    await waitFor(() => screens() === 1);
    await terminals.close(first, context);
    await waitFor(() => list().length === 1 && links.at(-1) === "closed");
  });

  test("removing the project closes its terminals and the pages connected to them", async () => {
    const { workspaces, terminals, workspaceId, list, open } = await start();
    const id = await terminals.create({ workspaceId }, context);
    const { links, screens } = open(id);
    await waitFor(() => screens() === 1);
    await workspaces.remove(workspaceId, context);
    await waitFor(() => list().length === 0 && links.at(-1) === "closed");
  });
});

describe("Terminals.create is refused", () => {
  test("for a project that does not exist", async () => {
    const { terminals } = await start();
    await expect(terminals.create({ workspaceId: 999 }, context)).rejects.toThrow(/does not exist/);
  });

  test("when the project's directory is gone", async () => {
    const { terminals, workspaceId, cwd, list } = await start();
    await rename(cwd, `${cwd}-moved`);
    await expect(terminals.create({ workspaceId }, context)).rejects.toThrow(/does not exist/);
    expect(list()).toEqual([]);
  });

  test("when the project has 10 terminals", async () => {
    const { terminals, workspaceId } = await start();
    for (let index = 0; index < 10; index += 1) await terminals.create({ workspaceId }, context);
    await expect(terminals.create({ workspaceId }, context)).rejects.toThrow(/at most 10/);
  });
});

describe("a terminal's socket", () => {
  test("Terminals.close is refused for a terminal that does not exist", async () => {
    const { terminals } = await start();
    await expect(terminals.close("nope", context)).rejects.toThrow(/does not exist/);
  });

  test("a resize that is not whole numbers closes the socket as a bad message, and the terminal stays", async () => {
    const { server, terminals, workspaceId, list } = await start();
    const id = await terminals.create({ workspaceId }, context);
    const url = new URL(terminalPath(id), server.url);
    url.protocol = "ws:";
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${server.token}` } });
    sockets.push(socket);
    await new Promise((resolve) => socket.once("open", resolve));
    const closed = new Promise<number>((resolve) => socket.once("close", (code) => resolve(code)));
    socket.send(JSON.stringify({ type: "resize", cols: 1.5, rows: 24 }));
    expect(await closed).toBe(1003);
    expect(list().map((summary) => summary.id)).toEqual([id]);
  });

  test("connects only with the token, from an allowed origin, to a terminal that exists", async () => {
    const { server, terminals, workspaceId } = await start();
    const id = await terminals.create({ workspaceId }, context);
    expect(await refused(server, terminalPath(id), "wrong")).toBe(401);
    expect(await refused(server, terminalPath(id), server.token, "https://evil.example")).toBe(403);
    expect(await refused(server, terminalPath("nope"), server.token)).toBe(404);
    // A path that is not valid percent-encoding is refused, before and after the token is checked.
    expect(await refused(server, "/pty/%E0", "wrong")).toBe(401);
    expect(await refused(server, "/pty/%E0", server.token)).toBe(404);
    expect(await refused(server, terminalPath(id), server.token, server.url.origin)).toBe(101);
  });
});
