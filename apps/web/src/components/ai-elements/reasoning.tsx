import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace.tsx";

export interface ReasoningProps {
  text: string;
  running?: boolean;
  duration?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children?: ReactNode;
}

/**
 * Reasoning displays the agent's thinking as it streams.
 * Follows the shadcn/ui AI Elements Reasoning pattern.
 */
export function Reasoning({
  text,
  running = false,
  duration,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen,
  children,
}: ReasoningProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? running);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = controlledOnOpenChange ?? setUncontrolledOpen;

  const line = (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>{running ? <LoaderCircleIcon className="animate-spin" /> : <CheckIcon />}</TraceIcon>
      <TraceTitle>{running ? "Thinking" : "Thought"}</TraceTitle>
      {duration !== undefined && <TraceDescription>{duration}s</TraceDescription>}
    </TraceLine>
  );

  if (text.length === 0 && children === undefined) {
    return line;
  }

  return (
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap">
        {children ?? <div className="text-sm text-muted-foreground">{text}</div>}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
