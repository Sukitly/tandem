import { cn } from "cn";
import type { ComponentProps, ReactNode } from "react";

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";

type CodePanelProps = Omit<ComponentProps<typeof CodeBlock>, "title"> & {
  /**
   * Source to show, and what the copy button copies. Re-rendering with a longer
   * string streams without re-highlighting.
   */
  code: string;
  /**
   * Shiki language id. Unknown or empty falls back to plain text. `diff` is
   * drawn as a diff: the lines that were added are green and the removed ones
   * red, each marked in the gutter, with the `+` and `-` taken off, and the
   * code in them highlighted in the language of the file (see `diffLanguage`).
   */
  language?: string;
  /**
   * The language of the code in a diff. Read from the file name in the header
   * when it is not set, so `+++ b/app.yml` is highlighted as `yml`. A diff with
   * no header and no `diffLanguage` has its lines tinted and not highlighted.
   */
  diffLanguage?: string;
  /**
   * Shown in the header. Defaults to the language. Pass `null` for no header:
   * the block is then only the code, with the copy button in the corner while
   * it is pointed at.
   */
  title?: ReactNode;
  /** Wrap long lines instead of scrolling sideways. */
  wrap?: boolean;
  /** Number the lines in a gutter. The copied text excludes the numbers. */
  lineNumbers?: boolean;
  /** The number of the first line, for a snippet from the middle of a file. */
  startLine?: number;
  /**
   * Cap the height of the code area, so long code scrolls inside it and does not
   * push the rest of the page away. Off unless asked. To size it yourself, leave
   * this off and give `contentClassName` a `max-h-*`: the cap is a condition of
   * the style, which a plain class does not beat.
   */
  capped?: boolean;
  /** Classes for the scrolling code area, for example `max-h-64` to cap its height. */
  contentClassName?: string;
};

type DiffLine = {
  text: string;
  kind: "added" | "removed" | "context" | "meta";
};

const DIFF_HEADERS = [
  "diff ",
  "index ",
  "--- ",
  "+++ ",
  "new file",
  "deleted file",
  "similarity",
  "rename ",
  "old mode",
  "new mode",
];

/**
 * Reads a unified diff into lines. The `+` or `-` that begins a changed line is
 * taken off, since the marker is drawn in the gutter. The lines of a file header
 * and the `@@` lines are only labels, and a line is only a header before the
 * first `@@` of its file, so a removed line that starts with `--` is not one.
 */
function parseDiff(code: string): DiffLine[] {
  const text = code.endsWith("\n") ? code.slice(0, -1) : code;
  let inHunk = false;

  return text.split("\n").map((line): DiffLine => {
    if (line.startsWith("diff ")) {
      inHunk = false;

      return { text: line, kind: "meta" };
    }

    if (line.startsWith("@@")) {
      inHunk = true;

      return { text: line, kind: "meta" };
    }

    if (!inHunk && DIFF_HEADERS.some((header) => line.startsWith(header))) {
      return { text: line, kind: "meta" };
    }

    if (line.startsWith("+")) {
      return { text: line.slice(1), kind: "added" };
    }

    if (line.startsWith("-")) {
      return { text: line.slice(1), kind: "removed" };
    }

    // A context line begins with the space that stands where the marker is.
    return {
      text: line.startsWith(" ") ? line.slice(1) : line,
      kind: "context",
    };
  });
}

/**
 * The language of the file a diff is of, from the extension in its header:
 * `+++ b/app.yml` is `yml`. A file that was deleted is read from its old name.
 */
function languageOfDiff(lines: DiffLine[]) {
  for (const line of lines) {
    const path = line.kind === "meta" ? /^(?:\+\+\+|---) (?:[ab]\/)?([^\t]+)/.exec(line.text)?.[1] : undefined;
    const extension = path ? /\.([A-Za-z0-9]+)$/.exec(path)?.[1] : undefined;

    if (extension) {
      return extension;
    }
  }

  return "";
}

/**
 * The changed and the unchanged lines between two labels, highlighted together
 * as the code they are, so a string or a comment that runs over lines is one.
 * The `+` and `-` are already off, and each line keeps its own tint.
 */
function DiffRun({ lines, language }: { lines: DiffLine[]; language: string }) {
  const highlighted = useHighlightedCode(lines.map((line) => line.text).join("\n"), language);

  return lines.map((line, index) => (
    <CodeBlockLine
      // The lines are ordered and never reorder.
      // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
      key={index}
      variant={line.kind === "added" || line.kind === "removed" ? line.kind : "default"}
    >
      {highlighted[index] ?? line.text}
    </CodeBlockLine>
  ));
}

/**
 * A unified diff, a line at a time. The added and the removed ones are the code
 * block's own variants, and the style tints them, through the content's
 * `data-diff`. A line that only labels, such as `@@`, is marked `data-meta` and
 * is not highlighted. What lies between two labels is highlighted as one piece
 * of code, so each hunk starts afresh, as it is not the lines before it.
 */
function DiffLines({ code, language }: { code: string; language: string | undefined }) {
  const lines = parseDiff(code);
  const lang = language ?? languageOfDiff(lines);
  const parts: (DiffLine | DiffLine[])[] = [];

  for (const line of lines) {
    const last = parts.at(-1);

    if (line.kind === "meta") {
      parts.push(line);
    } else if (Array.isArray(last)) {
      last.push(line);
    } else {
      parts.push([line]);
    }
  }

  return parts.map((part, index) =>
    Array.isArray(part) ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts only grow at the end
      <DiffRun key={index} lines={part} language={lang} />
    ) : (
      <CodeBlockLine
        // biome-ignore lint/suspicious/noArrayIndexKey: parts only grow at the end
        key={index}
        data-meta
      >
        {part.text}
      </CodeBlockLine>
    ),
  );
}

/**
 * A highlighted code block with a titled header, a divider, and a copy button.
 * `markdown` and `tool-call` both render through it, so anything added here
 * reaches both.
 */
function CodePanel({
  code,
  language = "",
  diffLanguage,
  title,
  wrap,
  lineNumbers,
  startLine,
  capped,
  contentClassName,
  className,
  children,
  ...props
}: CodePanelProps) {
  const isDiff = language.toLowerCase() === "diff";
  // Children are drawn as they are, so only the lines made here are a diff.
  const showsDiff = isDiff && children === undefined;
  // Only new lines are tokenized, so a block that keeps growing while it
  // streams does not re-highlight everything on each chunk. A diff is drawn
  // from its own lines and children are drawn as they are, so neither is
  // highlighted here.
  const lines = useHighlightedCode(isDiff || children !== undefined ? "" : code, language);

  return (
    <CodeBlock className={className} {...props}>
      {title === null ? (
        // Not the code block's own floating actions: they have a white fill and
        // a ring, and they stay showing once the block is clicked, since the
        // code area takes focus on a click. This is a plain ghost button that
        // fades in for a hover, or for focus that came from the keyboard, and
        // always shows on a touch screen, which has no hover.
        <div className="end-2 top-2 opacity-0 group-hover/code-block:opacity-100 group-has-[:focus-visible]/code-block:opacity-100 group-data-[size=sm]/code-block:end-1.5 group-data-[size=sm]/code-block:top-1.5 pointer-coarse:opacity-100 absolute z-10 transition-opacity motion-reduce:transition-none">
          <CodeBlockCopyButton value={code} />
        </div>
      ) : (
        <CodeBlockHeader className="border-b pb-3 group-data-[size=sm]/code-block:pb-2.5 group-data-[variant=destructive]/code-block:border-destructive/30">
          <CodeBlockTitle>{title ?? (language || "text")}</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton value={code} />
          </CodeBlockActions>
        </CodeBlockHeader>
      )}
      <CodeBlockContent
        wrap={wrap}
        lineNumbers={lineNumbers}
        startLine={startLine}
        // What the style needs to know: without a header the copy button floats
        // over the end of the code, a diff has its lines tinted, and a capped
        // panel stops at a height.
        data-untitled={title === null || undefined}
        data-diff={showsDiff || undefined}
        data-capped={capped || undefined}
        className={cn(
          "group-has-data-[slot=code-block-header]/code-block:pt-3 group-data-[size=sm]/code-block:group-has-data-[slot=code-block-header]/code-block:pt-2.5 data-[untitled=true]:pe-9 group-data-[size=sm]/code-block:data-[untitled=true]:pe-9 data-[untitled=true]:[&_[data-slot=code-block-line]:not([data-variant=default])]:-me-9 data-[untitled=true]:[&_[data-slot=code-block-line]:not([data-variant=default])]:pe-9 data-[diff=true]:[&_[data-slot=code-block-line][data-meta=true]]:text-muted-foreground data-[diff=true]:[&_[data-slot=code-block-line][data-variant=added]]:bg-green-500/15 data-[diff=true]:[&_[data-slot=code-block-line][data-variant=added]]:after:text-green-700 dark:data-[diff=true]:[&_[data-slot=code-block-line][data-variant=added]]:bg-green-500/20 dark:data-[diff=true]:[&_[data-slot=code-block-line][data-variant=added]]:after:text-green-400 data-[diff=true]:[&_[data-slot=code-block-line][data-variant=removed]]:bg-destructive/15 data-[capped=true]:max-h-64",
          contentClassName,
        )}
      >
        {children !== undefined ? (
          children
        ) : showsDiff ? (
          <DiffLines code={code} language={diffLanguage} />
        ) : (
          lines.map((line, index) => (
            // The line output is ordered and never reorders.
            // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
            <CodeBlockLine key={index}>{line}</CodeBlockLine>
          ))
        )}
      </CodeBlockContent>
    </CodeBlock>
  );
}

export { CodePanel };
