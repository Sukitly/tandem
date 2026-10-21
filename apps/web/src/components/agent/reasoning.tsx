import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";

type ReasoningContextValue = {
  streaming: boolean;
  durationMs?: number;
  icon?: ReactNode;
  expandable: boolean;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

function useReasoning() {
  const context = useContext(ReasoningContext);

  if (!context) {
    throw new Error("Reasoning parts must be used inside <Reasoning>");
  }

  return context;
}

/** "Thought for 5s", or "Thought" when the duration is unknown. */
function formatDuration(durationMs: number | undefined) {
  if (durationMs === undefined) {
    return "Thought";
  }

  if (durationMs < 1000) {
    return `Thought for ${durationMs}ms`;
  }

  return `Thought for ${Math.round(durationMs / 1000)}s`;
}

type ReasoningProps = {
  children: ReactNode;
  /** Reasoning is still arriving: the trigger shimmers and the panel opens. */
  streaming?: boolean;
  /** How long the model reasoned, shown as "Thought for 5s". */
  durationMs?: number;
  /**
   * Shown in place of the check once the reasoning is done, such as a brain.
   * While it streams the spinner stays, so the state is still told.
   */
  icon?: ReactNode;
  /**
   * Whether the reader can open the reasoning. Set `false` for a plain status
   * line with no arrow that cannot be clicked, for an app that shows that the
   * model is thinking but not what it thought. `ReasoningContent` then renders
   * nothing, so one tree can serve both kinds of app. `defaultOpen`, `open`
   * and `onOpenChange` are ignored.
   */
  expandable?: boolean;
  /** Open state before the reader interacts. Defaults to `streaming`. */
  defaultOpen?: boolean;
  /** Controlled open state. Pair with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

/**
 * The model's thinking, collapsed behind a one line summary. Built on the
 * shadcn/ui trace, so a running step shimmers and reduced motion is respected.
 */
function Reasoning({
  children,
  streaming = false,
  durationMs,
  icon,
  expandable = true,
  defaultOpen,
  open,
  onOpenChange,
  className,
}: ReasoningProps) {
  const [readerOpen, setReaderOpen] = useState<boolean | undefined>(defaultOpen);
  const isControlled = open !== undefined;

  // Until the reader takes over, the panel follows the stream: open while
  // reasoning arrives, collapsed once it is done.
  const isOpen = isControlled ? open : (readerOpen ?? streaming);

  function handleOpenChange(next: boolean) {
    if (!isControlled) {
      setReaderOpen(next);
    }
    onOpenChange?.(next);
  }

  const context = { streaming, durationMs, icon, expandable };

  if (!expandable) {
    return (
      <ReasoningContext.Provider value={context}>
        <Trace className={className}>{children}</Trace>
      </ReasoningContext.Provider>
    );
  }

  return (
    <ReasoningContext.Provider value={context}>
      <TraceCollapsible className={className} open={isOpen} onOpenChange={handleOpenChange}>
        {children}
      </TraceCollapsible>
    </ReasoningContext.Provider>
  );
}

type ReasoningTriggerProps = {
  /** Replaces the default label. */
  children?: ReactNode;
  /**
   * Writes the label from where the reasoning is, for text with the duration
   * in it, in your language: it gets `streaming`, and `durationMs` once it is
   * known. Replaces "Thinking" and "Thought for 5s". `children` wins over it.
   */
  label?: (state: { streaming: boolean; durationMs?: number }) => ReactNode;
  className?: string;
};

function ReasoningTrigger({ children, label, className }: ReasoningTriggerProps) {
  const { streaming, durationMs, icon, expandable } = useReasoning();

  const parts = (
    <>
      <TraceIcon>{streaming ? <Spinner className="motion-reduce:animate-none" /> : (icon ?? <CheckIcon />)}</TraceIcon>
      <TraceTitle>
        {children ?? (label ? label({ streaming, durationMs }) : streaming ? "Thinking" : formatDuration(durationMs))}
      </TraceTitle>
    </>
  );

  // Without the collapsible there is no button and no arrow, only the line.
  if (!expandable) {
    return (
      <TraceLine status={streaming ? "running" : undefined} className={className}>
        {parts}
      </TraceLine>
    );
  }

  return (
    <TraceCollapsibleTrigger className={className}>
      <TraceLine status={streaming ? "running" : undefined}>{parts}</TraceLine>
    </TraceCollapsibleTrigger>
  );
}

type ReasoningContentProps = {
  children: ReactNode;
  className?: string;
};

function ReasoningContent({ children, className }: ReasoningContentProps) {
  const { expandable } = useReasoning();

  if (!expandable) {
    return null;
  }

  return (
    // `whitespace-pre-wrap` keeps the model's own line breaks. Pass
    // `whitespace-normal` when rendering markdown instead of plain text.
    <TraceCollapsibleContent className={cn("whitespace-pre-wrap", className)}>{children}</TraceCollapsibleContent>
  );
}

export { Reasoning, ReasoningContent, ReasoningTrigger };
