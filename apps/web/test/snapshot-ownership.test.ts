import type { FileContent, Files } from "@tandem/contracts";
import { expect, test, vi } from "vitest";
import { createQueryClient } from "../src/app/query-client.tsx";
import { ProjectFiles } from "../src/files/project-files.ts";

const text = (value: string): FileContent => ({ kind: "text", text: value, size: value.length });

test("snapshot caches isolate both service identity and project identity", async () => {
  const client = createQueryClient();
  const firstService = { read: vi.fn(async () => text("first")) } as unknown as Files;
  const secondService = { read: vi.fn(async () => text("second")) } as unknown as Files;
  const first = new ProjectFiles(firstService, 1, client);
  const anotherProject = new ProjectFiles(firstService, 2, client);
  const second = new ProjectFiles(secondService, 1, client);
  try {
    first.open("a.ts");
    anotherProject.open("a.ts");
    second.open("a.ts");
    await vi.waitFor(() => expect(second.content).toEqual({ status: "ready", value: text("second") }));
    expect(first.content).toEqual({ status: "ready", value: text("first") });
    expect(firstService.read).toHaveBeenCalledTimes(2);
    expect(client.getQueryCache().getAll()).toHaveLength(3);
    first.dispose();
    expect(client.getQueryCache().getAll()).toHaveLength(2);
    expect(second.content?.status).toBe("ready");
  } finally {
    client.clear();
  }
});

test("disposing a project cancels pending snapshots and prevents late resurrection", async () => {
  const client = createQueryClient();
  let finish!: (content: FileContent) => void;
  const files = new ProjectFiles(
    {
      read: () =>
        new Promise<FileContent>((resolve) => {
          finish = resolve;
        }),
    } as unknown as Files,
    1,
    client,
  );
  files.open("a.ts");
  expect(client.getQueryCache().getAll()).toHaveLength(1);
  files.dispose();
  finish(text("late"));
  await Promise.resolve();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(files.content).toBeNull();
  client.clear();
});

test("multiple consumers deduplicate a shared directory snapshot", async () => {
  const client = createQueryClient();
  const service = { list: vi.fn(async () => []) } as unknown as Files;
  const first = new ProjectFiles(service, 1, client);
  const second = new ProjectFiles(service, 1, client);
  try {
    first.load("");
    second.load("");
    await vi.waitFor(() => expect(first.directory("")?.status).toBe("ready"));
    expect(second.directory("")).toEqual({ status: "ready", value: [] });
    expect(service.list).toHaveBeenCalledOnce();
  } finally {
    client.clear();
  }
});
