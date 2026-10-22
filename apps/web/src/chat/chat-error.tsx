import { AlertCircleIcon } from "lucide-react";
import { ToolCall, ToolCallContent, ToolCallTrigger } from "@/components/agent/tool-call.tsx";
import { cn } from "@/lib/utils.ts";
import { CopyableCode } from "./copyable-code.tsx";

/**
 * A failure is an expandable trace event, not a separate alert card: its line says what failed and the first line of
 * the error, and opened it holds the attempts and the complete error, as plain text that can be copied.
 */
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

  return (
    <div data-historical={historical || undefined} className={cn("min-w-0", className)}>
      <ToolCall status="error" icon={<AlertCircleIcon />} expandable={hasError || multipleAttempts}>
        <ToolCallTrigger summary={summary === "" ? undefined : `· ${summary}`}>
          <span className="shrink-0">{title}</span>
        </ToolCallTrigger>
        <ToolCallContent>
          {multipleAttempts && <p className="text-xs">{attempts} attempts</p>}
          {hasError && (
            <CopyableCode value={error} label="Copy" variant="destructive" className="max-h-64">
              {error}
            </CopyableCode>
          )}
        </ToolCallContent>
      </ToolCall>
    </div>
  );
}
