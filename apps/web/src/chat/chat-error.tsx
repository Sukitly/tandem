import { AlertCircleIcon, CheckIcon, CopyIcon } from "lucide-react";
import { MessageAction } from "@/components/ai-elements/message.tsx";
import { useCopyText } from "@/components/copy-text.tsx";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace.tsx";
import { cn } from "@/lib/utils.ts";

export function CopyAction({ text, className }: { text: string; className?: string }) {
  const { copied, pending, copy } = useCopyText(text);
  return (
    <MessageAction
      label={copied ? "Copied" : "Copy"}
      className={className}
      disabled={pending}
      onClick={() => void copy()}
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </MessageAction>
  );
}

/** A failure is an expandable trace event, not a separate alert card. */
export function ChatError({
  title = "Generation failed",
  error,
  attempts,
  historical = false,
  className,
}: {
  title?: string;
  error?: string;
  attempts?: number;
  historical?: boolean;
  className?: string;
}) {
  const hasError = error !== undefined && error !== "";
  const multipleAttempts = attempts !== undefined && attempts > 1;
  const firstLine = error
    ?.split("\n")
    .find((line) => line.trim() !== "")
    ?.trim();
  const summary = firstLine === undefined ? "" : firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine;
  const line = (
    <TraceLine status="error">
      <TraceIcon>
        <AlertCircleIcon />
      </TraceIcon>
      <span className="shrink-0">{title}</span>
      {summary !== "" && <TraceTitle>· {summary}</TraceTitle>}
    </TraceLine>
  );

  return (
    <Trace className={cn("group/message", className)} data-historical={historical || undefined}>
      {hasError || multipleAttempts ? (
        <TraceCollapsible>
          <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <div className="grid min-w-0 gap-2">
              {multipleAttempts && <p className="text-xs">{attempts} attempts</p>}
              {hasError && (
                <div className="flex min-w-0 items-start gap-2">
                  <pre className="min-w-0 flex-1 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere">
                    {error}
                  </pre>
                  <CopyAction text={error} className="opacity-100" />
                </div>
              )}
            </div>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      ) : (
        line
      )}
    </Trace>
  );
}
