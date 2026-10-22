import { cn } from "cn";
import { BanIcon, ChevronDownIcon, CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";

type CompactionStatus = "working" | "done" | "failed" | "aborted";

const LABELS: Record<CompactionStatus, string> = {
  working: "Compacting the conversation",
  done: "Older messages were summarized",
  failed: "The conversation could not be compacted",
  aborted: "Compacting was stopped",
};

const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCompact(value: number) {
  return compact.format(value);
}

function formatTokens(before: number, after: number) {
  return `${formatCompact(before)} → ${formatCompact(after)} tokens`;
}

type CompactionMarkerProps = {
  /**
   * Where the compaction is. All four are the same line, with the words in the
   * middle and a rule either side, so it does not move when the status
   * changes. `working` has a spinner, `done` marks where older messages were
   * summarized, and `failed` and `aborted` have an icon, the one of a failure
   * in the colour of an error.
   */
  status: CompactionStatus;
  /**
   * Replaces the words of the line. The defaults are English: "Compacting the
   * conversation", "Older messages were summarized", "The conversation could
   * not be compacted" and "Compacting was stopped".
   */
  label?: ReactNode;
  /**
   * The size of the context before and after, in tokens. When both are given a
   * finished compaction shows them after its words, as "245K → 32K tokens".
   */
  tokensBefore?: number;
  tokensAfter?: number;
  /**
   * Writes the two figures, with their unit and in the language of the reader.
   * The default is "245K → 32K tokens", in compact notation.
   */
  formatSize?: (before: number, after: number) => ReactNode;
  /** While it works, a button that stops it. It shows only when this is given. */
  onCancel?: () => void;
  /** The words of that button. Defaults to "Cancel". */
  cancelLabel?: ReactNode;
  /** After it failed, a button that tries again. It shows only when this is given. */
  onRetry?: () => void;
  /** The words of that button. Defaults to "Try again". */
  retryLabel?: ReactNode;
  /**
   * What the model was left with in place of the older messages, such as the
   * summary as markdown. Given on a finished compaction, its words are a button
   * with an arrow that opens it; it does nothing for another status, and
   * without it the line is only a line.
   */
  children?: ReactNode;
  /** Open state before the reader interacts. Defaults to closed. */
  defaultOpen?: boolean;
  /** Controlled open state. Pair with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

/**
 * A compaction in a transcript: a line with its words in the middle, from the
 * moment it starts to the one that marks where it was done, or that it failed.
 * Built on the shadcn/ui marker, so it is the full width of the column and a
 * message list item holds it, as it does a message. The words, the buttons and
 * the summary are yours.
 */
function CompactionMarker({
  status,
  label,
  tokensBefore,
  tokensAfter,
  formatSize = formatTokens,
  onCancel,
  cancelLabel = "Cancel",
  onRetry,
  retryLabel = "Try again",
  children,
  defaultOpen,
  open,
  onOpenChange,
  className,
}: CompactionMarkerProps) {
  const expandable = status === "done" && children != null;
  const figures =
    status === "done" && tokensBefore != null && tokensAfter != null ? formatSize(tokensBefore, tokensAfter) : null;

  const text = (
    <MarkerContent
      className={cn(
        // The marker does not shrink the words of a line with rules, so a long
        // label would run out of the column. Let it wrap.
        "group-data-[variant=separator]/marker:flex-initial",
        status === "working" && "shimmer motion-reduce:shimmer-none",
      )}
    >
      {label ?? LABELS[status]}
      {figures ? (
        <>
          {" · "}
          <span className="tabular-nums">{figures}</span>
        </>
      ) : null}
    </MarkerContent>
  );

  const icon =
    status === "working" ? (
      <MarkerIcon>
        <Spinner className="motion-reduce:animate-none" />
      </MarkerIcon>
    ) : status === "failed" || status === "aborted" ? (
      <MarkerIcon data-status={status} className="data-[status=failed]:text-destructive">
        {status === "failed" ? <CircleAlertIcon /> : <BanIcon />}
      </MarkerIcon>
    ) : null;

  const action =
    status === "working" && onCancel ? (
      <Button type="button" variant="secondary" size="xs" className="shrink-0" onClick={onCancel}>
        {cancelLabel}
      </Button>
    ) : status === "failed" && onRetry ? (
      <Button type="button" variant="secondary" size="xs" className="shrink-0" onClick={onRetry}>
        {retryLabel}
      </Button>
    ) : null;

  return (
    <Collapsible
      data-slot="compaction-marker"
      data-status={status}
      className={cn("flex w-full min-w-0 flex-col", className)}
      open={expandable ? open : undefined}
      defaultOpen={expandable ? defaultOpen : undefined}
      onOpenChange={onOpenChange}
    >
      {/* Always a live region, so a screen reader hears the line change from
          working to done. Only the words are a button, with the arrow: the
          rules either side are not, and neither is the width of the line. */}
      <Marker variant="separator" role="status">
        {icon}
        {expandable ? (
          <CollapsibleTrigger className="cursor-pointer gap-1 rounded-md px-1.5 py-0.5 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 group/compaction-trigger inline-flex min-w-0 items-center text-center">
            {text}
            <MarkerIcon className="transition-transform group-aria-expanded/compaction-trigger:rotate-180 motion-reduce:transition-none">
              <ChevronDownIcon />
            </MarkerIcon>
          </CollapsibleTrigger>
        ) : (
          text
        )}
        {action}
      </Marker>
      {expandable && (
        <CollapsibleContent className="h-(--collapsible-panel-height) min-w-0 overflow-hidden transition-[height] data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
          <div className="mt-3 max-h-64 rounded-lg bg-muted px-4 py-3 text-sm ring-1 ring-foreground/5 dark:ring-foreground/10 overflow-y-auto">
            {children}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

export type { CompactionMarkerProps, CompactionStatus };
export { CompactionMarker };
