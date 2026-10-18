import { CodeBlock, CodeBlockContent, CodeBlockLine } from "@/components/ui/code-block.tsx";

export interface ParsedDiffLine {
  type: "add" | "delete" | "context";
  lineNumber?: string;
  text: string;
}

export function parseDiffLine(raw: string): ParsedDiffLine {
  if (raw.startsWith("+")) {
    const rest = raw.slice(1);
    const match = /^\s*(\d+)?\s*(.*)$/.exec(rest);
    return {
      type: "add",
      lineNumber: match?.[1],
      text: match?.[2] ?? rest,
    };
  }
  if (raw.startsWith("-")) {
    const rest = raw.slice(1);
    const match = /^\s*(\d+)?\s*(.*)$/.exec(rest);
    return {
      type: "delete",
      lineNumber: match?.[1],
      text: match?.[2] ?? rest,
    };
  }
  const match = /^\s*(\d+)?\s*(.*)$/.exec(raw);
  return {
    type: "context",
    lineNumber: match?.[1],
    text: match?.[2] ?? raw,
  };
}

export function ToolDiff({ diff }: { diff: string }) {
  const lines = diff.split("\n").map(parseDiffLine);
  return (
    <CodeBlock size="sm">
      <CodeBlockContent className="max-h-80">
        {lines.map((line, index) => {
          const variant = line.type === "add" ? "added" : line.type === "delete" ? "removed" : "default";
          const display = line.lineNumber ? `${line.lineNumber}  ${line.text}` : line.text;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional
            <CodeBlockLine key={index} variant={variant}>
              {display}
            </CodeBlockLine>
          );
        })}
      </CodeBlockContent>
    </CodeBlock>
  );
}

/** Argument context only; tool names are displayed verbatim from the conversation. */
export function toolDescription(args: Record<string, unknown>): string {
  if (typeof args.path === "string") {
    const offset = typeof args.offset === "number" ? args.offset : undefined;
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    const range =
      offset === undefined && limit === undefined
        ? ""
        : `:${offset ?? 1}${limit === undefined ? "" : `-${(offset ?? 1) + limit - 1}`}`;
    return `${args.path}${range}`;
  }
  if (typeof args.command === "string") return args.command;
  if (typeof args.threadId === "number" || typeof args.threadId === "string") return `#${args.threadId}`;
  return Object.keys(args).length === 0 ? "" : JSON.stringify(args);
}
