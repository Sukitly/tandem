import { cn } from "cn";
import { BanIcon, CheckIcon, CircleDashedIcon, TriangleAlertIcon } from "lucide-react";
import { type ComponentProps, createContext, type ReactNode, useContext, useState } from "react";

import { CodePanel } from "@/components/agent/code-panel";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";

type ToolCallStatus = "pending" | "running" | "success" | "error" | "cancelled";

/**
 * Maps our five states onto the statuses the trace line styles. The line has
 * none for a cancelled call, which is drawn by `data-cancelled` instead.
 */
const TRACE_STATUS = {
  pending: "pending",
  running: "running",
  success: undefined,
  error: "error",
  cancelled: undefined,
} as const;

type ToolCallContextValue = {
  name?: string;
  status: ToolCallStatus;
  icon?: ReactNode;
  durationMs?: number;
  expandable: boolean;
};

const ToolCallContext = createContext<ToolCallContextValue | null>(null);

function useToolCall() {
  const context = useContext(ToolCallContext);

  if (!context) {
    throw new Error("Tool call parts must be used inside <ToolCall>");
  }

  return context;
}

/** "4.2s", "400ms", "12s". */
function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  if (durationMs < 10_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  return `${Math.round(durationMs / 1000)}s`;
}

function StatusIcon({ status }: { status: ToolCallStatus }) {
  if (status === "running") {
    return <Spinner className="motion-reduce:animate-none" />;
  }

  if (status === "error") {
    return <TriangleAlertIcon />;
  }

  if (status === "cancelled") {
    return <BanIcon />;
  }

  if (status === "pending") {
    return <CircleDashedIcon />;
  }

  return <CheckIcon />;
}

type ToolCallProps = {
  children: ReactNode;
  /**
   * Tool name, shown in the trigger badge. Leave it out for an app whose
   * readers should not see tool names, and no badge is drawn.
   */
  name?: string;
  /**
   * Where the call is. `cancelled` is a call that was interrupted before it
   * could give a result, by the reader or by the app: not a failure, so it is
   * not red, but dimmed and struck through.
   */
  status?: ToolCallStatus;
  /**
   * The tool's own icon, for example a search or terminal icon. Defaults to
   * one chosen from `status`.
   */
  icon?: ReactNode;
  /** How long the call took, rendered as "4.2s". */
  durationMs?: number;
  /**
   * Whether the reader can open the call. Set `false` for a plain status line
   * with no arrow that cannot be clicked. `ToolCallContent` then renders
   * nothing, so one tree can serve an app that shows tool details and one that
   * hides them. `defaultOpen`, `open` and `onOpenChange` are ignored.
   */
  expandable?: boolean;
  /** Open state before the reader interacts. Defaults to open while running. */
  defaultOpen?: boolean;
  /** Controlled open state. Pair with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

/**
 * A single tool call: one line summary that expands into whatever the call
 * needs to show. Built on the shadcn/ui trace, so a running call shimmers, a
 * failed one turns red, a cancelled one is struck through, and reduced motion
 * is respected.
 */
function ToolCall({
  children,
  name,
  status = "success",
  icon,
  durationMs,
  expandable = true,
  defaultOpen,
  open,
  onOpenChange,
  className,
}: ToolCallProps) {
  const [readerOpen, setReaderOpen] = useState<boolean | undefined>(defaultOpen);
  const isControlled = open !== undefined;

  // Let the reader watch output arrive, then collapse once the call settles.
  const isOpen = isControlled ? open : (readerOpen ?? status === "running");

  function handleOpenChange(next: boolean) {
    if (!isControlled) {
      setReaderOpen(next);
    }
    onOpenChange?.(next);
  }

  const context = { name, status, icon, durationMs, expandable };

  if (!expandable) {
    return (
      <ToolCallContext.Provider value={context}>
        <Trace className={className}>{children}</Trace>
      </ToolCallContext.Provider>
    );
  }

  return (
    <ToolCallContext.Provider value={context}>
      <TraceCollapsible className={className} open={isOpen} onOpenChange={handleOpenChange}>
        {children}
      </TraceCollapsible>
    </ToolCallContext.Provider>
  );
}

type ToolCallTriggerProps = {
  /**
   * What this call actually did, for example the command it ran or the error
   * it hit. Kept in the collapsed row, and it shimmers while the call runs.
   */
  summary?: ReactNode;
  /**
   * Secondary text at the end of the line, before the duration, such as the
   * lines that were read or what an edit changed: "lines 10–40", "+3 −1".
   */
  description?: ReactNode;
  /** Replaces the tool name badge. */
  children?: ReactNode;
  className?: string;
};

function ToolCallTrigger({ summary, description, children, className }: ToolCallTriggerProps) {
  const { name, status, icon, durationMs, expandable } = useToolCall();

  const parts = (
    <>
      <TraceIcon>{icon ?? <StatusIcon status={status} />}</TraceIcon>
      {children ?? (name ? <Badge variant="secondary">{name}</Badge> : null)}
      {summary && <TraceTitle>{summary}</TraceTitle>}
      {description && <TraceDescription>{description}</TraceDescription>}
      {durationMs !== undefined && <TraceDescription>{formatDuration(durationMs)}</TraceDescription>}
    </>
  );

  // Without the collapsible there is no button and no arrow, only the line.
  if (!expandable) {
    return (
      <TraceLine
        status={TRACE_STATUS[status]}
        data-cancelled={status === "cancelled" || undefined}
        className={cn(
          "data-[cancelled=true]:text-muted-foreground/70 data-[cancelled=true]:*:data-[slot=trace-title]:line-through",
          className,
        )}
      >
        {parts}
      </TraceLine>
    );
  }

  return (
    <TraceCollapsibleTrigger className={className}>
      <TraceLine
        status={TRACE_STATUS[status]}
        data-cancelled={status === "cancelled" || undefined}
        className="data-[cancelled=true]:text-muted-foreground/70 data-[cancelled=true]:*:data-[slot=trace-title]:line-through"
      >
        {parts}
      </TraceLine>
    </TraceCollapsibleTrigger>
  );
}

type ToolCallContentProps = {
  children: ReactNode;
  /**
   * How `ToolCallBlock`s are laid out. `separate` is each block on its own, with
   * a gap between them. `joined` is one box with a divider between the blocks,
   * for an input and its output, or a command and what it printed.
   */
  layout?: "separate" | "joined";
  className?: string;
};

/**
 * The expansion slot. Put anything here: code blocks, tables, images. It
 * renders nothing when the call is not `expandable`.
 *
 * It gives every code block inside it a soft fill and a faint border, so a block
 * reads as part of the line above it, not as a white card. That is for any code
 * block, a `ToolCallBlock` or one built from the code block's own parts, so
 * what you make yourself matches. A failed one keeps its red. The rules are
 * `:where`, which has no weight of its own, so a block's own focus border and
 * its dark fill still win.
 */
function ToolCallContent({ children, layout = "separate", className }: ToolCallContentProps) {
  const { expandable } = useToolCall();

  if (!expandable) {
    return null;
  }

  return (
    <TraceCollapsibleContent
      className={cn(
        "gap-3 [&_:where([data-slot=code-block][data-variant=default])]:border-border/70 [&_:where([data-slot=code-block][data-variant=default])]:bg-muted/40 flex flex-col",
        className,
      )}
    >
      {layout === "joined" ? (
        // The box is the container's, so the blocks give up their own borders
        // and corners, and every block after the first is divided from the one
        // above it.
        <div
          data-slot="tool-call-joined"
          className="rounded-lg border border-border/70 *:data-[slot=code-block]:rounded-none *:data-[slot=code-block]:border-0 [&>[data-slot=code-block]+[data-slot=code-block]]:border-t flex min-w-0 flex-col overflow-hidden"
        >
          {children}
        </div>
      ) : (
        children
      )}
    </TraceCollapsibleContent>
  );
}

type ToolCallBlockProps = Omit<ComponentProps<typeof CodePanel>, "title" | "language"> & {
  /**
   * Shown in the block header, for example "Input" or "Output". Leave it out for
   * a block with no header, when the summary already says what it holds.
   */
  label?: string;
  /** Shiki language id, or `diff` for a diff. Without one it is plain text. */
  language?: string;
  /** Use `destructive` for a failed call's error text. */
  variant?: "default" | "destructive";
};

/**
 * A code block for a call's input, output, or error, labelled or not. It is a
 * `CodePanel` with a few defaults for tool output, and takes all of its props,
 * such as `lineNumbers` and `startLine`. Pass `children` to draw the content
 * yourself instead of highlighting `code`, which is then only what the copy
 * button copies.
 *
 * Tool output can run to thousands of lines, so the defaults cap the height at
 * 16rem and wrap long lines, so one block cannot push the rest of the
 * transcript off screen and a single wide line reads without scrolling
 * sideways. Pass `wrap={false}` or `capped={false}` to change either. The cap
 * is a condition of the style, which a plain class does not beat, so to size a
 * block yourself turn `capped` off and give `contentClassName` a `max-h-*`.
 */
function ToolCallBlock({
  label,
  language = "text",
  variant = "default",
  size = "sm",
  wrap = true,
  capped = true,
  contentClassName,
  ...props
}: ToolCallBlockProps) {
  return (
    <CodePanel
      title={label ?? null}
      language={language}
      variant={variant}
      size={size}
      wrap={wrap}
      capped={capped}
      contentClassName={contentClassName}
      {...props}
    />
  );
}

export { ToolCall, ToolCallBlock, ToolCallContent, ToolCallTrigger };
