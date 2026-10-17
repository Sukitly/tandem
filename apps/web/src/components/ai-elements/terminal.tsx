import { Loader2Icon, TerminalIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block.tsx";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace.tsx";

export interface TerminalProps {
  command: string;
  output?: string;
  exitCode?: number;
  status: "pending" | "running" | "done" | "error" | "failed" | "cancelled";
  defaultOpen?: boolean;
  children?: ReactNode;
}

function getTitle(command: string, status: TerminalProps["status"], exitCode?: number): string {
  if (exitCode !== undefined && exitCode !== 0) return `${command} exited with code ${exitCode}`;
  switch (status) {
    case "running":
      return `Running ${command}`;
    case "done":
      return `Ran ${command}`;
    case "cancelled":
      return `Cancelled ${command}`;
    case "error":
    case "failed":
      return `Failed to run ${command}`;
    default:
      return `Run ${command}`;
  }
}

/**
 * Terminal displays a command the agent runs, with its output as it streams.
 * Follows the shadcn/ui AI Elements Terminal pattern.
 */
export function Terminal({ command, output = "", exitCode, status, defaultOpen, children }: TerminalProps) {
  const [open, setOpen] = useState(defaultOpen);
  const running = status === "running";
  const failed = status === "error" || status === "failed" || (exitCode !== undefined && exitCode !== 0);
  const traceStatus = failed ? "error" : running ? "running" : status === "pending" ? "pending" : undefined;
  const hasContent = output.length > 0 || children !== undefined;
  const line = (
    <TraceLine status={traceStatus}>
      <TraceIcon>
        {running && !failed ? <Loader2Icon className="animate-spin motion-reduce:animate-none" /> : <TerminalIcon />}
      </TraceIcon>
      <TraceTitle className="font-mono shimmer-none!">{getTitle(command, status, exitCode)}</TraceTitle>
    </TraceLine>
  );

  if (!hasContent) return line;

  return (
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        {children}
        {output.length > 0 && (
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-64">
              {output}
            </CodeBlockContent>
          </CodeBlock>
        )}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
