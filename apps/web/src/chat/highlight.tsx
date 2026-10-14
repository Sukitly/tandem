import { code as highlighter } from "@streamdown/code";
import { type CSSProperties, useEffect, useState } from "react";

type HighlightOptions = Parameters<typeof highlighter.highlight>[0];

/** One highlighted piece of a line, as Shiki gives it; text that is not highlighted yet has only `content`. */
export interface Token {
  content: string;
  color?: string | undefined;
  htmlStyle?: Record<string, string> | undefined;
}

export type Tokens = Token[][];

/** One line of highlighted code, colored for the light and the dark theme. */
export function HighlightedLine({ tokens, className }: { tokens: Token[]; className?: string }) {
  return (
    <span className={className}>
      {tokens.map((token, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positions in the line.
          key={index}
          className="code-token"
          style={tokenStyle(token)}
        >
          {token.content}
        </span>
      ))}
    </span>
  );
}

/**
 * The Shiki language of a file, from its name: its extension (`.ts`, `.yml`), or the whole name for files such as
 * `Dockerfile` and `Makefile`; `undefined` for plain text.
 */
export function languageOfFile(name: string): string | undefined {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  for (const candidate of [dot > 0 ? lower.slice(dot + 1) : undefined, lower]) {
    if (candidate !== undefined && highlighter.supportsLanguage(candidate as HighlightOptions["language"])) {
      return candidate;
    }
  }
  return undefined;
}

/** Shiki's tokens for `code`, once its highlighter for the language has loaded; until then, `undefined`. */
export function useHighlighted(code: string, language: string | undefined, streaming: boolean): Tokens | undefined {
  const [result, setResult] = useState<{ code: string; tokens: Tokens } | undefined>(undefined);
  useEffect(() => {
    if (language === undefined || language === "") return;
    let current = true;
    const options = {
      code,
      language: language as HighlightOptions["language"],
      themes: highlighter.getThemes(),
      isIncomplete: streaming,
    };
    const ready = highlighter.highlight(options, (late) => {
      if (current) setResult({ code, tokens: late.tokens });
    });
    if (ready !== null) setResult({ code, tokens: ready.tokens });
    return () => {
      current = false;
    };
  }, [code, language, streaming]);
  if (result === undefined) return undefined;
  if (result.code === code) return result.tokens;
  // While text streams in, keep the older tokens and add what arrived since as plain text, until its own are in.
  if (!code.startsWith(result.code)) return undefined;
  const [first = "", ...rest] = code.slice(result.code.length).split("\n");
  const lines = result.tokens.map((line) => [...line]);
  lines.at(-1)?.push({ content: first });
  return [...lines, ...rest.map((line) => [{ content: line }])];
}

/** The token's color in each theme; Shiki puts the dark one in `--shiki-dark`. */
function tokenStyle(token: Token): CSSProperties {
  const light = token.htmlStyle?.color ?? token.color ?? "inherit";
  const dark = token.htmlStyle?.["--shiki-dark"] ?? light;
  return { "--code-light": light, "--code-dark": dark } as CSSProperties;
}
