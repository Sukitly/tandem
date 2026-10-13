import type { PromptOrigin } from "@tandem/contracts";

/** A prompt template with its body: a Markdown file turned into a slash command. */
export interface PromptTemplate {
  /** The command name: the file's name without `.md`. */
  name: string;
  description: string;
  argumentHint?: string;
  /** The template's text, without its frontmatter. */
  content: string;
  origin: PromptOrigin;
}

/** Read a template from a file's name and contents. */
export function parsePromptTemplate(fileName: string, raw: string, origin: PromptOrigin): PromptTemplate {
  const { frontmatter, body } = parseFrontmatter(raw);
  const name = fileName.replace(/\.md$/, "");
  let description = frontmatter.description ?? "";
  if (description === "") {
    const firstLine = body.split("\n").find((line) => line.trim() !== "");
    if (firstLine !== undefined) {
      description = firstLine.trim().slice(0, 60);
      if (firstLine.trim().length > 60) description += "...";
    }
  }
  const argumentHint = frontmatter["argument-hint"];
  return { name, description, ...(argumentHint === undefined ? {} : { argumentHint }), content: body, origin };
}

/**
 * Split a template file into its frontmatter and its body: a leading `---` block of `key: value` lines, and the text
 * after it. Only simple scalar values are read, which is what a template uses; anything else is left to the body.
 */
export function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const content = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^\uFEFF/, "");
  if (!content.startsWith("---")) return { frontmatter: {}, body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: content };
  return { frontmatter: parseScalars(content.slice(4, end)), body: content.slice(end + 4).trim() };
}

function parseScalars(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (match === null) continue;
    const [, key, value] = match;
    if (key === undefined || value === undefined) continue;
    values[key] = unquote(value.trim());
  }
  return values;
}

function unquote(value: string): string {
  const first = value.at(0);
  const last = value.at(-1);
  if (value.length >= 2 && first === last && (first === '"' || first === "'")) return value.slice(1, -1);
  return value;
}

/** Split command arguments respecting quoted strings (bash-style). */
export function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of argsString) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current !== "") {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current !== "") args.push(current);
  return args;
}

/**
 * Substitute argument placeholders in a template's text: `$1`, `$2`, … for one positional argument, `$@` and
 * `$ARGUMENTS` for all of them, `${N:-default}` and `${@:-default}` for a value with a default, and `${@:N}` /
 * `${@:N:L}` for a slice. Substitution happens on the template only: an argument that looks like a placeholder is
 * inserted as it is, never expanded again.
 */
export function substituteArgs(content: string, args: string[]): string {
  const allArgs = args.join(" ");
  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (_match, defaultTarget, defaultValue, sliceStart, sliceLength, simple) => {
      if (defaultTarget !== undefined) {
        const value =
          defaultTarget === "@" || defaultTarget === "ARGUMENTS"
            ? allArgs
            : args[Number.parseInt(defaultTarget, 10) - 1];
        return value !== undefined && value !== "" ? value : (defaultValue ?? "");
      }
      if (sliceStart !== undefined) {
        const start = Math.max(0, Number.parseInt(sliceStart, 10) - 1);
        if (sliceLength !== undefined) return args.slice(start, start + Number.parseInt(sliceLength, 10)).join(" ");
        return args.slice(start).join(" ");
      }
      if (simple === "ARGUMENTS" || simple === "@") return allArgs;
      return args[Number.parseInt(simple, 10) - 1] ?? "";
    },
  );
}

/**
 * Expand `/name args` into a template's text, or return the text as it is when it names no template (so a message that
 * merely begins with a slash still reaches the agent).
 */
export function expandPromptTemplate(text: string, templates: readonly PromptTemplate[]): string {
  if (!text.startsWith("/")) return text;
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text);
  if (match === null) return text;
  const name = match[1];
  if (name === undefined) return text;
  const template = templates.find((candidate) => candidate.name === name);
  if (template === undefined) return text;
  return substituteArgs(template.content, parseCommandArgs(match[2] ?? ""));
}
