import { code as highlighter } from "@streamdown/code";
import { CheckIcon, CopyIcon } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type HighlightOptions = Parameters<typeof highlighter.highlight>[0];

/** One highlighted piece of a line, as Shiki gives it; text that is not highlighted yet has only `content`. */
interface Token {
  content: string;
  color?: string | undefined;
  htmlStyle?: Record<string, string> | undefined;
}

type Tokens = Token[][];

/**
 * A block of code: one flat surface, highlighted with Shiki in the light and the dark theme, with a copy button that
 * shows on hover. Used for code in messages and for tool output, so both look the same.
 */
export function CodeBlock({
  code,
  language,
  streaming = false,
  tall = false,
  className,
}: {
  code: string;
  /** A Shiki language name; anything unknown renders as plain text. */
  language?: string | undefined;
  /** Still arriving: highlighting results are not cached. */
  streaming?: boolean;
  /** Long output, such as a tool's: scrolls past a fixed height instead of growing. */
  tall?: boolean;
  className?: string;
}) {
  // A final newline would render as an empty last line.
  const text = code.endsWith("\n") ? code.slice(0, -1) : code;
  const tokens = useHighlighted(text, language, streaming);
  return (
    <div className={cn("group/code relative min-w-0 rounded-md bg-muted", className)}>
      <pre className={cn("overflow-x-auto p-3 font-mono text-xs leading-relaxed", tall && "max-h-80 overflow-y-auto")}>
        <code>
          {tokens === undefined
            ? text
            : tokens.map((line, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are positions in the text.
                <span key={index} className="block min-h-[1lh]">
                  {line.map((token, tokenIndex) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positions in the line.
                      key={tokenIndex}
                      className="text-(--code-light) dark:text-(--code-dark)"
                      style={tokenStyle(token)}
                    >
                      {token.content}
                    </span>
                  ))}
                </span>
              ))}
        </code>
      </pre>
      <CopyCode code={code} />
    </div>
  );
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={copied ? "Copied" : "Copy code"}
      className="absolute top-1.5 right-1.5 opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100"
      onClick={() => {
        void navigator.clipboard.writeText(code).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

/** Shiki's tokens for `code`, once its highlighter for the language has loaded; until then, `undefined`. */
function useHighlighted(code: string, language: string | undefined, streaming: boolean): Tokens | undefined {
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
  const style: Record<string, string> = {};
  const light = token.htmlStyle?.color ?? token.color;
  const dark = token.htmlStyle?.["--shiki-dark"];
  if (light !== undefined) style["--code-light"] = light;
  style["--code-dark"] = dark ?? light ?? "inherit";
  if (light === undefined) style["--code-light"] = "inherit";
  return style as CSSProperties;
}
