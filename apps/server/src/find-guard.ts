import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineExtension, type Extension, hook, section, ToolTask } from "@earendil-works/pi-durable";

/**
 * Tandem's `find` policy, ported from the pi extension of the same name: the agent searches with `fd` and `rg`, not
 * with `find`. The built-in `bash` tool is left as it is; every agent Bash call is rewritten to resolve `find` to a
 * shim that refuses, and a call that names an explicit `find` path is refused before it runs.
 */

/** The rule the agent reads in its system prompt. */
export const FIND_GUIDANCE =
  "Bash command policy: `find` is disabled. Use `fd` for file-name or path searches and `rg` for content searches.";

/** What the agent reads when a `find` call is refused, or the shim runs. */
export const FIND_DISABLED_MESSAGE =
  "Error: find is disabled. Use fd instead:\n\n  File-name/path search: fd PATTERN PATH\n  File extension search: fd -e EXT . PATH\n  Content search: rg PATTERN PATH";

/** A mark that the shim is already on the command's PATH, so a replayed call is not rewritten twice. */
const POLICY_MARKER = ": # tandem-disable-find";

/** The shim: it reports the policy and fails, so a bare `find` never runs and never reads as an empty result. */
const SHIM_SCRIPT = `#!/bin/bash

set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
cat "$script_dir/message.txt" >&2
exit 1
`;

/** What a Bash call is checked and rewritten against. */
export interface FindPolicy {
  /** The directory holding the shim; agent Bash calls get it at the front of their PATH. */
  shimDirectory: string;
  /** What a refused call and the shim say. */
  message: string;
}

/**
 * Write the shim and its message under `directory`, and return the policy that uses them. Called once, when the server
 * starts; the directory may be the state directory, which is private to the user already.
 */
export async function writeFindShim(directory: string): Promise<FindPolicy> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "message.txt"), `${FIND_DISABLED_MESSAGE}\n`, { mode: 0o600 });
  await writeFile(join(directory, "find"), SHIM_SCRIPT, { mode: 0o755 });
  return { shimDirectory: directory, message: FIND_DISABLED_MESSAGE };
}

/**
 * The extension: a prompt rule, and the guard on every agent Bash call. Nothing is changed but `bash`: another tool
 * named `find` a project installs is left alone.
 */
export function findGuard(policy: FindPolicy): Extension {
  return defineExtension({
    name: "tandem.findGuard",
    sections: [section("bash_policy", () => FIND_GUIDANCE, { tag: false })],
    hooks: [
      hook(ToolTask, {
        beforeTool(call) {
          if (call.name !== "bash") return undefined;
          const command = (call.arguments as { command?: unknown }).command;
          if (typeof command !== "string") return undefined;
          if (isExplicitFindInvocation(command)) return { block: policy.message };
          return { arguments: { ...call.arguments, command: prependFindShimPath(command, policy.shimDirectory) } };
        },
      }),
    ],
  });
}

/** Quote a value so a POSIX shell reads it as one literal word. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Put the shim's directory at the front of the call's PATH, once. */
export function prependFindShimPath(command: string, shimDirectory: string): string {
  if (command.startsWith(`${POLICY_MARKER}\n`)) return command;
  return `${POLICY_MARKER}\nexport PATH=${shellQuote(shimDirectory)}:"$PATH"\n${command}`;
}

/**
 * Whether the command names `find` with a path, such as `/usr/bin/find`: the shim cannot catch those, because a path
 * bypasses PATH, so they are refused before the call runs. A bare `find` is left to the shim, which the command's
 * rewritten PATH resolves to.
 */
export function isExplicitFindInvocation(command: string): boolean {
  return explicitFindPattern.test(maskQuotedTextAndComments(maskHeredocBodies(command)));
}

/**
 * A run of shell text with the bodies of heredocs blanked, so a `find` inside a heredoc (a commit message, a written
 * file) is not read as a command.
 */
function maskHeredocBodies(command: string): string {
  const lines = command.match(/.*(?:\n|$)/g)?.filter(Boolean) ?? [];
  const pending: { delimiter: string; stripTabs: boolean }[] = [];
  let masked = "";

  for (const line of lines) {
    const hasNewline = line.endsWith("\n");
    const content = hasNewline ? line.slice(0, -1) : line;

    const current = pending[0];
    if (current !== undefined) {
      const comparable = current.stripTabs ? content.replace(/^\t+/, "") : content;
      masked += " ".repeat(content.length) + (hasNewline ? "\n" : "");
      if (comparable === current.delimiter) pending.shift();
      continue;
    }

    masked += line;
    const heredocPattern = /(?:^|[^<])<<(-?)(?!<)\s*(?:'([^']+)'|"([^"]+)"|([^\s;&|()]+))/g;
    for (const match of content.matchAll(heredocPattern)) {
      const delimiter = match[2] ?? match[3] ?? match[4];
      if (delimiter) pending.push({ delimiter, stripTabs: match[1] === "-" });
    }
  }

  return masked;
}

/** The same text with quoted strings and comments blanked, so a mention of `find` inside them is not read as a command. */
function maskQuotedTextAndComments(command: string): string {
  let masked = "";
  let quote: "single" | "double" | null = null;
  let comment = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";

    if (comment) {
      if (char === "\n") {
        comment = false;
        masked += "\n";
      } else {
        masked += " ";
      }
      continue;
    }

    if (quote === "single") {
      if (char === "'") quote = null;
      masked += " ";
      continue;
    }

    if (quote === "double") {
      if (char === "\\" && index + 1 < command.length) {
        masked += "  ";
        index += 1;
        continue;
      }
      if (char === '"') quote = null;
      masked += " ";
      continue;
    }

    if (char === "\\" && index + 1 < command.length) {
      masked += "  ";
      index += 1;
      continue;
    }
    if (char === "'") {
      quote = "single";
      masked += " ";
      continue;
    }
    if (char === '"') {
      quote = "double";
      masked += " ";
      continue;
    }
    if (char === "#" && (index === 0 || /\s/.test(command[index - 1] ?? ""))) {
      comment = true;
      masked += " ";
      continue;
    }
    if (char === "`") {
      masked += ";";
      continue;
    }

    masked += char;
  }

  return masked;
}

const explicitFindPattern =
  /(?:^|\n|[;|&]{1,2}|\$\()\s*(?:(?:if|then|do|else|elif|while|until|time|sudo|command|builtin)\s+)*(?:\S+\/)+find(?=$|\s|[;|&)])/m;
