import { TerminalIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block.tsx";
import { Tool } from "./tool.tsx";

export interface TerminalProps {
  name: string;
  command: string;
  input?: Record<string, unknown>;
  output?: string;
  exitCode?: number;
  status: "pending" | "running" | "done" | "error" | "failed" | "cancelled";
  defaultOpen?: boolean;
  children?: ReactNode;
}

/**
 * Terminal displays a command the agent runs, with its output as it streams.
 * Follows the shadcn/ui AI Elements Terminal pattern.
 */
export function Terminal({
  name,
  command,
  input,
  output = "",
  exitCode,
  status,
  defaultOpen,
  children,
}: TerminalProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasContent = output.length > 0 || children !== undefined;
  return (
    <Tool
      name={name}
      input={input ?? { command }}
      description={
        <span className="font-mono">
          {command}
          {exitCode !== undefined && exitCode !== 0 && ` (exit ${exitCode})`}
        </span>
      }
      icon={<TerminalIcon />}
      status={exitCode !== undefined && exitCode !== 0 ? "failed" : status}
      open={open ?? status === "running"}
      onOpenChange={setOpen}
    >
      {hasContent ? (
        <>
          {children}
          {output.length > 0 && (
            <CodeBlock size="sm">
              <CodeBlockContent wrap className="max-h-64">
                {output}
              </CodeBlockContent>
            </CodeBlock>
          )}
        </>
      ) : undefined}
    </Tool>
  );
}
