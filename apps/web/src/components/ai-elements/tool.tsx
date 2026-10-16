import { CheckIcon, Loader2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block.tsx";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace.tsx";

export interface ToolProps {
  name: string;
  description?: ReactNode;
  input?: Record<string, unknown>;
  icon?: ReactNode;
  status?: "pending" | "running" | "done" | "error" | "failed" | "cancelled";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children?: ReactNode;
}

/**
 * Tool displays a generic tool execution step in a Trace list.
 * Follows the shadcn/ui AI Elements Tool pattern without coupling to specific domain tools.
 */
export function Tool({
  name,
  description,
  input,
  icon = <CheckIcon />,
  status,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen,
  children,
}: ToolProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? status === "running");
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = controlledOnOpenChange ?? setUncontrolledOpen;

  const running = status === "running";
  const failed = status === "error" || status === "failed";
  const traceStatus: "running" | "error" | "pending" | undefined = running
    ? "running"
    : failed
      ? "error"
      : status === "pending"
        ? "pending"
        : undefined;

  const line = (
    <TraceLine status={traceStatus}>
      <TraceIcon>{running ? <Loader2Icon className="animate-spin motion-reduce:animate-none" /> : icon}</TraceIcon>
      <Badge variant="outline" className="max-w-48 min-w-0 font-mono" title={name}>
        <span className="truncate">{name}</span>
      </Badge>
      {description !== undefined && <TraceTitle className="shimmer-none!">{description}</TraceTitle>}
      {(failed || status === "cancelled") && <TraceDescription>{status}</TraceDescription>}
    </TraceLine>
  );

  const hasOutput = children !== undefined && children !== null && children !== false;
  if (input === undefined && !hasOutput) {
    return line;
  }

  return (
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div className="grid min-w-0 gap-3">
          {input !== undefined && (
            <div className="grid min-w-0 gap-1">
              <div className="text-xs font-medium">Input</div>
              <CodeBlock size="sm">
                <CodeBlockContent wrap className="max-h-64">
                  {JSON.stringify(input, null, 2)}
                </CodeBlockContent>
              </CodeBlock>
            </div>
          )}
          {hasOutput && (
            <div className="grid min-w-0 gap-1">
              <div className="text-xs font-medium">Output</div>
              {children}
            </div>
          )}
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
