import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
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
  defaultOpen?: boolean;
  children?: ReactNode;
}

/**
 * Reasoning displays the agent's thinking as it streams.
 * Follows the shadcn/ui AI Elements Reasoning pattern.
 */
export function Reasoning({ text, running = false, duration, defaultOpen, children }: ReasoningProps) {
  const [open, setOpen] = useState<boolean | undefined>(defaultOpen);

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
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap">
        {children ?? <div className="text-sm text-muted-foreground">{text}</div>}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
