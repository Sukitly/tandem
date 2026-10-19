import { TerminalIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton } from "@/components/ui/code-block.tsx";
import { Tool } from "./tool.tsx";

export interface TerminalProps {
  /** The backend tool name, shown verbatim in the badge. */
  name: string;
  command: string;
  /** The call's other arguments (such as a timeout), shown beneath the command exactly as the backend named them. */
  options?: Record<string, unknown>;
  output?: string;
  exitCode?: number;
  status: "pending" | "running" | "done" | "error" | "failed" | "cancelled";
  defaultOpen?: boolean;
  children?: ReactNode;
}

/** Units of the bash tool's numeric arguments, which the backend states only in the argument's description. */
const OPTION_UNITS: Record<string, string> = { timeout: "s" };

function formatOption(key: string, value: unknown): string {
  if (typeof value === "number") return `${value}${OPTION_UNITS[key] ?? ""}`;
  return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
}

/**
 * Terminal displays a command the agent runs, with its output as it streams.
 * The title line is a one-line summary that truncates; expanding shows one block holding the complete command and
 * its arguments, a divider, and then the output.
 * Follows the shadcn/ui AI Elements Terminal pattern.
 */
export function Terminal({
  name,
  command,
  options = {},
  output = "",
  exitCode,
  status,
  defaultOpen,
  children,
}: TerminalProps) {
  const [open, setOpen] = useState(defaultOpen);
  const exited = exitCode !== undefined && exitCode !== 0;
  const optionEntries = Object.entries(options);
  const hasInput = command.length > 0 || optionEntries.length > 0;
  const hasContent = hasInput || output.length > 0 || children !== undefined;
  return (
    <Tool
      name={name}
      description={<span className="font-mono">{command}</span>}
      outputLabel={null}
      icon={<TerminalIcon />}
      status={exited ? "failed" : status}
      statusLabel={exited ? `failed (exit ${exitCode})` : undefined}
      open={open ?? status === "running"}
      onOpenChange={setOpen}
    >
      {hasContent ? (
        <>
          {children}
          {(hasInput || output.length > 0) && (
            <CodeBlock size="sm">
              {command.length > 0 && (
                <>
                  <CodeBlockActions>
                    <CodeBlockCopyButton value={command} aria-label="Copy command" />
                  </CodeBlockActions>
                  <CodeBlockContent wrap className="max-h-40 pe-9">
                    <span>
                      <span aria-hidden="true" className="text-muted-foreground select-none">
                        {"$ "}
                      </span>
                      {command}
                    </span>
                  </CodeBlockContent>
                </>
              )}
              {optionEntries.length > 0 && (
                <div
                  data-slot="terminal-options"
                  className="-mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 px-2.5 pb-2.5 font-mono wrap-break-word text-muted-foreground"
                >
                  {optionEntries.map(([key, value]) => (
                    <span key={key}>
                      {key} <span className="text-foreground">{formatOption(key, value)}</span>
                    </span>
                  ))}
                </div>
              )}
              {hasInput && output.length > 0 && <hr className="border-border/70" />}
              {output.length > 0 && (
                <CodeBlockContent wrap className="max-h-64">
                  {output}
                </CodeBlockContent>
              )}
            </CodeBlock>
          )}
        </>
      ) : undefined}
    </Tool>
  );
}
