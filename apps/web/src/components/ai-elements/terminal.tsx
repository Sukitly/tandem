import { TerminalIcon } from "lucide-react";
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
  if (status === "running") {
    return `Running ${command}`;
  }
  if (status === "cancelled") {
    return `Cancelled ${command}`;
  }
  if (status === "error" || status === "failed" || (exitCode !== undefined && exitCode !== 0)) {
    return exitCode !== undefined && exitCode !== 0
      ? `${command} exited with code ${exitCode}`
      : `Failed to run ${command}`;
  }
  if (status === "done") {
    return `Ran ${command}`;
  }
  return `Run ${command}`;
}

/**
 * Terminal displays a command the agent runs, with its output as it streams.
 * Follows the shadcn/ui AI Elements Terminal pattern.
 */
export function Terminal({ command, output = "", exitCode, status, defaultOpen, children }: TerminalProps) {
  const [open, setOpen] = useState(defaultOpen);
  const running = status === "running";
  const failed = status === "error" || status === "failed" || (exitCode !== undefined && exitCode !== 0);
  const traceStatus: "running" | "error" | "pending" | undefined = running
    ? "running"
    : failed
      ? "error"
      : status === "pending"
        ? "pending"
        : undefined;

  const hasContent = output.length > 0 || children !== undefined;
  const title = getTitle(command, status, exitCode);

  const line = (
    <TraceLine status={traceStatus}>
      <TraceIcon>
        <TerminalIcon />
      </TraceIcon>
      <TraceTitle className="font-mono">{title}</TraceTitle>
    </TraceLine>
  );

  if (!hasContent) {
    return line;
  }

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
