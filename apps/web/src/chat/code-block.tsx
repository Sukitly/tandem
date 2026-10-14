import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HighlightedLine, useHighlighted } from "./highlight.tsx";

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
  const displayLanguage = language || (tall ? "output" : "code");

  return (
    <div
      className={cn(
        "group/code relative min-w-0 overflow-hidden rounded-xl border border-border/60 bg-muted/40",
        className,
      )}
    >
      <div className="flex h-8 items-center justify-between border-b border-border/40 bg-muted/30 px-3.5 text-xs text-muted-foreground select-none">
        <span className="font-mono text-[11px] font-medium lowercase tracking-wide">{displayLanguage}</span>
        <CopyCode code={code} />
      </div>
      <pre
        className={cn(
          "overflow-x-auto p-3.5 font-mono text-[13px] leading-relaxed",
          tall && "max-h-80 overflow-y-auto",
        )}
      >
        <code>
          {tokens === undefined
            ? text
            : tokens.map((line, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are positions in the text.
                <HighlightedLine key={index} tokens={line} className="block min-h-[1lh]" />
              ))}
        </code>
      </pre>
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
      className="h-6 w-6 text-muted-foreground hover:text-foreground transition-colors [@media(hover:hover)]:opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100"
      onClick={() => {
        void navigator.clipboard.writeText(code).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-green-600 dark:text-green-400" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </Button>
  );
}
