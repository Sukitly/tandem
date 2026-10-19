import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { connect, OpenConversations, type TandemConnection } from "@tandem/client";
import { Conversation, Conversations, Prompts, Workspaces } from "@tandem/contracts";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { startApp } from "../src/app.ts";
import { createFauxProvider } from "../src/models.ts";
import type { TandemServer } from "../src/server.ts";

const context = BACKGROUND_CONTEXT;
let server: TandemServer;
let connection: TandemConnection;
let prompts: Prompts;
let conversations: Conversations;
let open: OpenConversations;
let project: string;
let globalDir: string;
let workspaceId: number;

beforeEach(async () => {
  globalDir = await mkdtemp(join(tmpdir(), "tandem-prompts-global-"));
  project = await mkdtemp(join(tmpdir(), "tandem-prompts-project-"));
  server = await startApp({
    port: 0,
    providers: [createFauxProvider()],
    stateDir: await mkdtemp(join(tmpdir(), "tandem-test-")),
    globalPromptsDir: globalDir,
  });
  connection = await connect({
    baseUrl: server.url,
    token: server.token,
    services: [Workspaces, Prompts, Conversations, Conversation],
  });
  prompts = connection.services.use(Prompts);
  conversations = connection.services.use(Conversations);
  open = new OpenConversations(connection);
  workspaceId = await connection.services.use(Workspaces).add({ path: project }, context);
});

afterEach(async () => {
  open.dispose();
  await connection.close();
  await server.stop();
});

/** Write a template file, creating its directory. */
async function template(dir: string, name: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), content);
}

const projectDir = () => join(project, ".pi", "prompts");

/** Send a first message and read what the agent was given, which the faux provider echoes back. */
async function sent(text: string): Promise<string> {
  const id = await conversations.start({ workspaceId, text }, context);
  const release = open.hold(id);
  try {
    await waitFor(() => open.get(id)?.view.value !== undefined);
    await waitFor(() => !isBusy(id));
    const answer = answers(id)[0] ?? "";
    return answer.replace(/^You said: /, "");
  } finally {
    release();
  }
}

function answers(id: number): string[] {
  return (open.get(id)?.view.value?.entries ?? []).flatMap((entry) =>
    (entry.model ?? []).flatMap((message) =>
      message.role === "assistant"
        ? message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
        : [],
    ),
  );
}

function isBusy(id: number): boolean {
  return open.get(id)?.view.value?.docs["pi.live"]?.run !== undefined;
}

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("prompts", () => {
  test("lists the project's templates and the user's, with the frontmatter read", async () => {
    await template(globalDir, "commit.md", "---\ndescription: Write a commit\n---\nCommit the work.\n");
    await template(
      projectDir(),
      "review.md",
      ["---", "description: Review changes", 'argument-hint: "[focus]"', "---", "Review them."].join("\n"),
    );
    expect(await prompts.list(workspaceId, context)).toEqual([
      { name: "commit", description: "Write a commit", origin: "global" },
      { name: "review", description: "Review changes", argumentHint: "[focus]", origin: "project" },
    ]);
  });

  test("reads the description from the first line, and ignores what is not a template", async () => {
    await template(globalDir, "plan.md", "\n  Make a plan first\nsecond line\n");
    await template(globalDir, ".hidden.md", "not a command");
    await template(globalDir, "notes.txt", "not a command");
    await mkdir(join(globalDir, "weird.md"), { recursive: true });
    expect(await prompts.list(workspaceId, context)).toEqual([
      { name: "plan", description: "Make a plan first", origin: "global" },
    ]);
  });

  test("a project template wins over the user's of the same name", async () => {
    await template(globalDir, "review.md", "Global review.");
    await template(projectDir(), "review.md", "Project review.");
    expect(await prompts.list(workspaceId, context)).toEqual([
      { name: "review", description: "Project review.", origin: "project" },
    ]);
    expect(await sent("/review")).toBe("Project review.");
  });

  test("a message naming a template becomes its text, with the arguments substituted", async () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the template's own placeholders, not JavaScript.
    await template(projectDir(), "review.md", "Focus on ${1:-correctness}, then ${2:-style}.");
    expect(await sent("/review security")).toBe("Focus on security, then style.");
    expect(await sent('/review "error handling" performance')).toBe("Focus on error handling, then performance.");
    expect(await sent("/review")).toBe("Focus on correctness, then style.");
  });

  test("a message that names no template reaches the agent as it is", async () => {
    await template(projectDir(), "review.md", "Review.");
    expect(await sent("/nothing here")).toBe("/nothing here");
    expect(await sent("a /review later")).toBe("a /review later");
  });

  test("a project without templates, and one that was removed, are refused or empty", async () => {
    expect(await prompts.list(workspaceId, context)).toEqual([]);
    await expect(prompts.list(99, context)).rejects.toThrow("Project 99 does not exist");
  });
});
