import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { connect, type TandemConnection } from "@tandem/client";
import { Repository } from "@tandem/contracts";
import { afterEach, expect, test } from "vitest";
import { startApp } from "../src/app.ts";
import { createFauxProvider } from "../src/models.ts";
import type { TandemServer } from "../src/server.ts";

let server: TandemServer | undefined;
let stateDir: string | undefined;
const connections: TandemConnection[] = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
  await server?.stop();
  if (stateDir) await rm(stateDir, { recursive: true, force: true });
});

test("repository validation and subscriptions work through RPC after a new connection", async () => {
  stateDir = await mkdtemp(join(tmpdir(), "tandem-repository-"));
  server = await startApp({ port: 0, stateDir, providers: [createFauxProvider()] });
  for (let attempt = 0; attempt < 2; attempt++) {
    const connection = await connect({
      baseUrl: server.url,
      token: server.token,
      services: [Repository],
      reconnect: false,
    });
    connections.push(connection);
    await connection.services.ready(BACKGROUND_CONTEXT);
    const repository = connection.services.use(Repository);
    await expect(repository.refresh(12345, BACKGROUND_CONTEXT)).rejects.toThrow("does not exist");
    await expect(repository.refresh("1" as unknown as number, BACKGROUND_CONTEXT)).rejects.toThrow("integer");
    expect(repository.state.value).toEqual({ projects: {} });
    await connection.close();
    connections.pop();
  }
});
