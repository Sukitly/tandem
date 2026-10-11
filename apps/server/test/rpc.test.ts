import {
  type Context,
  defineService,
  RemoteServiceProvider,
  type ReplicatedState,
  replicatedState,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { BootstrapError, connect, type TandemConnection } from "@tandem/client";
import { RPC_PATH, TOKEN_QUERY_PARAMETER } from "@tandem/contracts";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocket as NodeWebSocket } from "ws";
import { type StartServerOptions, startServer, type TandemServer } from "../src/server.ts";

interface Counter {
  readonly state: ReplicatedState<{ count: number }>;
  add(amount: number, context: Context): Promise<number>;
}
const Counter = defineService<Counter>("test.counter");

const context = BACKGROUND_CONTEXT;
const servers: TandemServer[] = [];
const connections: TandemConnection[] = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

/** A server whose connections all share one counter. */
async function startCounterServer(options: StartServerOptions = {}) {
  const state = replicatedState({ count: 0 });
  const released = { count: 0 };
  const server = await startServer({
    port: 0,
    ...options,
    createConnectionServices() {
      const provider = new RemoteServiceProvider([Counter]);
      provider.provide(Counter, {
        state,
        async add(amount, callContext) {
          state.change(callContext, (draft) => {
            draft.count += amount;
          });
          return state.value.count;
        },
      });
      return { provider, dispose: () => released.count++ };
    },
  });
  servers.push(server);
  return { server, state, released };
}

async function connectTo(server: TandemServer, options: { reconnect?: false } = {}) {
  const connection = await connect({
    baseUrl: server.url,
    token: server.token,
    services: [Counter],
    reconnect: options.reconnect ?? { initialDelayMs: 20, maxDelayMs: 100 },
  });
  connections.push(connection);
  const counter = connection.services.use(Counter);
  await connection.services.ready(context);
  return { connection, counter };
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function rawSocket(server: TandemServer, token: string, headers: Record<string, string> = {}) {
  const url = new URL(RPC_PATH, server.url);
  url.protocol = "ws:";
  url.searchParams.set(TOKEN_QUERY_PARAMETER, token);
  const socket = new NodeWebSocket(url, { headers });
  return new Promise<{ opened: boolean; status?: number }>((resolve) => {
    socket.once("open", () => {
      socket.close();
      resolve({ opened: true });
    });
    socket.once("unexpected-response", (_request, response) => resolve({ opened: false, status: response.statusCode }));
    socket.once("error", () => resolve({ opened: false }));
  });
}

describe("rpc over WebSocket", () => {
  test("calls methods and replicates state to every connection", async () => {
    const { server } = await startCounterServer();
    const first = await connectTo(server);
    const second = await connectTo(server);
    expect(first.counter.state.value).toEqual({ count: 0 });

    expect(await first.counter.add(2, context)).toBe(2);
    await waitFor(() => first.counter.state.value?.count === 2 && second.counter.state.value?.count === 2);

    await second.counter.add(3, context);
    await waitFor(() => first.counter.state.value?.count === 5);
  });

  test("rejects a wrong token at bootstrap and at the WebSocket upgrade", async () => {
    const { server } = await startCounterServer();
    await expect(connect({ baseUrl: server.url, token: "wrong", services: [Counter] })).rejects.toBeInstanceOf(
      BootstrapError,
    );
    expect(await rawSocket(server, "wrong")).toEqual({ opened: false, status: 401 });
  });

  test("rejects browser origins other than the server's own and the allowed ones", async () => {
    const { server } = await startCounterServer({ allowedOrigins: ["http://127.0.0.1:5173"] });
    expect(await rawSocket(server, server.token, { origin: "http://evil.example" })).toEqual({
      opened: false,
      status: 403,
    });
    expect(await rawSocket(server, server.token, { origin: "http://127.0.0.1:5173" })).toEqual({ opened: true });
    expect(await rawSocket(server, server.token, { origin: server.url.origin })).toEqual({ opened: true });
    expect(await rawSocket(server, server.token)).toEqual({ opened: true });
  });

  test("releases a connection's services when it closes", async () => {
    const { server, released } = await startCounterServer();
    const { connection } = await connectTo(server, { reconnect: false });
    expect(released.count).toBe(0);
    await connection.close();
    await waitFor(() => released.count === 1);
  });

  test("reconnects and rehydrates state after the server restarts", async () => {
    const { server, state } = await startCounterServer();
    // Default reconnect options: reconnecting is on unless disabled.
    const connection = await connect({ baseUrl: server.url, token: server.token, services: [Counter] });
    connections.push(connection);
    const counter = connection.services.use(Counter);
    await connection.services.ready(context);
    await counter.add(1, context);
    await waitFor(() => counter.state.value?.count === 1);

    await server.stop();
    servers.splice(servers.indexOf(server), 1);
    await waitFor(() => connection.status.value?.status === "disconnected");

    // Down long enough for several reconnect attempts to fail.
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Same identity, token, and port; the state lives on in the test.
    state.replace(context, { count: 41 });
    const restarted = await startServer({
      port: server.url.port === "" ? 0 : Number(server.url.port),
      serverId: server.serverId,
      token: server.token,
      createConnectionServices() {
        const provider = new RemoteServiceProvider([Counter]);
        provider.provide(Counter, { state, add: async () => state.value.count });
        return { provider };
      },
    });
    servers.push(restarted);

    await waitFor(() => connection.status.value?.status === "connected" && counter.state.value?.count === 41, 5_000);
  });
});
