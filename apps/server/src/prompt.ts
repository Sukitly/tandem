import { posix } from "node:path";
import type { Context } from "@earendil-works/chord";
import { defineExtension, type Extension, section } from "@earendil-works/pi-durable";

/** Files whose instructions the agent follows, looked up in the working directory and each directory above it. */
const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];

const PREAMBLE =
  "You are an expert coding assistant working inside Tandem, where a user works with you on a local repository " +
  "from the browser. You help by reading files, running commands, editing code, and writing new files. The user " +
  "sees your messages, your tool calls with their output, and the changes you make to files.";

const TOOLS = [
  "- read: Read the contents of a file",
  "- bash: Run a shell command in the working directory",
  "- edit: Replace exact text in a file",
  "- write: Create a file or overwrite it",
  "- reply_to_comment: Reply to a review comment, in its thread beside the code",
].join("\n");

const RULES = [
  "- Use bash for listing, searching, and finding files (ls, rg, fd)",
  "- Read a file before editing it, and prefer edit over write for existing files",
  "- Be concise in your responses",
  "- Show file paths clearly when working with files",
  "- A message may carry review comments, each headed `Comment #N` with the line it is about. Answer each one with " +
    "reply_to_comment: what you changed for it, or what you need to know. Then sum up in your message",
].join("\n");

/**
 * Tandem's system prompt: who the agent is, its tools, the project's instruction files, and the working directory.
 * pi's coding agent builds its prompt in internal code, so Tandem writes its own in the same shape.
 */
export const TandemPrompt: Extension = defineExtension({
  name: "tandem.prompt",
  sections: [
    section("preamble", () => PREAMBLE, { tag: false }),
    section("tools", () => TOOLS),
    section("rules", () => RULES),
    section("project_context", async ({ env }, context) => {
      if (env === undefined) return undefined;
      const files = await instructionFiles(env, context);
      if (files.length === 0) return undefined;
      return [
        "Project-specific instructions and guidelines:",
        ...files.map(
          ({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`,
        ),
      ].join("\n\n");
    }),
    section("cwd", ({ env }) => env?.cwd),
  ],
});

interface TextReader {
  readonly cwd: string;
  readTextFile(path: string, context: Context): Promise<{ ok: true; value: string } | { ok: false; error: unknown }>;
}

/** Instruction files from the outermost directory to the working directory, so the nearest one reads last. */
async function instructionFiles(env: TextReader, context: Context): Promise<{ path: string; content: string }[]> {
  const found: { path: string; content: string }[] = [];
  let directory = env.cwd;
  for (;;) {
    for (const name of INSTRUCTION_FILES) {
      const path = posix.join(directory, name);
      const result = await env.readTextFile(path, context);
      if (result.ok) {
        found.unshift({ path, content: result.value });
        // One file per directory: AGENTS.md wins over CLAUDE.md.
        break;
      }
    }
    const parent = posix.dirname(directory);
    if (parent === directory) return found;
    directory = parent;
  }
}
