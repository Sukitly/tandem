import { AlertCircleIcon, CheckIcon, CopyIcon } from "lucide-react";
import { MessageAction, Reasoning, Terminal, Tool } from "@/components/ai-elements/index.ts";
import { useCopyText } from "@/components/copy-text.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Bubble, BubbleContent } from "@/components/ui/bubble.tsx";
import { CodeBlock, CodeBlockContent, CodeBlockLine } from "@/components/ui/code-block.tsx";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker.tsx";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
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
import { Markdown } from "./markdown.tsx";
import type { AssistantPart, TranscriptItem } from "./transcript.ts";
import { TranscriptImages } from "./transcript-images.tsx";

export function TranscriptEntry({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "user":
      // Markdown, like an answer: a message that carries review comments names the places it is about as links.
      return (
        <Message align="end">
          <MessageContent>
            <TranscriptImages images={item.images} className="max-w-[85%] justify-end" />
            {item.text !== "" && (
              <Bubble align="end" variant="muted">
                <BubbleContent>
                  <Markdown text={item.text} />
                </BubbleContent>
              </Bubble>
            )}
            {item.text !== "" && (
              <MessageFooter className="px-0">
                <CopyAction text={item.text} />
              </MessageFooter>
            )}
          </MessageContent>
        </Message>
      );
    case "assistant":
      return <AssistantMessage item={item} />;
    case "compaction":
      return (
        <Marker variant="separator">
          <MarkerContent>Older messages were summarized</MarkerContent>
        </Marker>
      );
    case "compacting":
      return (
        <Marker role="status">
          <MarkerIcon>
            <Spinner />
          </MarkerIcon>
          <MarkerContent>Compacting the conversation</MarkerContent>
        </Marker>
      );
  }
}

/** Three dots bouncing in turn: the agent is at work but nothing on screen moves. As in pmgg. */
export function WaitingDots({ label = "Working" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex h-5 items-center gap-1.5 px-1">
      <span className="size-1.5 animate-typing-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
      <span className="size-1.5 animate-typing-bounce rounded-full bg-muted-foreground/60 [animation-delay:700ms]" />
      <span className="size-1.5 animate-typing-bounce rounded-full bg-muted-foreground/60 [animation-delay:1400ms]" />
    </div>
  );
}

type StepPart = Extract<AssistantPart, { kind: "thinking" | "tool" }>;

type AssistantSegment = { kind: "steps"; key: string; steps: StepPart[] } | { kind: "text"; key: string; text: string };

function segmentAssistantParts(parts: readonly AssistantPart[]): AssistantSegment[] {
  const segments: AssistantSegment[] = [];
  let currentSteps: StepPart[] = [];
  let stepIndex = 0;
  let textIndex = 0;

  for (const part of parts) {
    if (part.kind === "text") {
      if (currentSteps.length > 0) {
        segments.push({ kind: "steps", key: `steps-${stepIndex++}`, steps: currentSteps });
        currentSteps = [];
      }
      segments.push({ kind: "text", key: `text-${textIndex++}`, text: part.text });
    } else {
      currentSteps.push(part);
    }
  }

  if (currentSteps.length > 0) {
    segments.push({ kind: "steps", key: `steps-${stepIndex++}`, steps: currentSteps });
  }

  return segments;
}

function AssistantMessage({ item }: { item: Extract<TranscriptItem, { kind: "assistant" }> }) {
  const streaming = item.ending === "streaming";
  const text = item.parts.flatMap((part) => (part.kind === "text" ? [part.text] : [])).join("\n\n");
  // A message that calls tools is a step on the way; copying is for answers.
  const answer = !item.parts.some((part) => part.kind === "tool");
  const segments = segmentAssistantParts(item.parts);

  return (
    <Message align="start">
      <MessageContent className="gap-3">
        {segments.map((segment, segIdx) => {
          const isLastSegment = segIdx === segments.length - 1;
          if (segment.kind === "steps") {
            return (
              <Trace key={segment.key}>
                {segment.steps.map((step, stepIdx) => {
                  const isLastStep = isLastSegment && stepIdx === segment.steps.length - 1;
                  if (step.kind === "thinking") {
                    return (
                      <Reasoning
                        // biome-ignore lint/suspicious/noArrayIndexKey: thinking step sequence is stable
                        key={stepIdx}
                        text={step.text}
                        running={streaming && isLastStep}
                      >
                        <div className="text-sm text-muted-foreground">
                          <Markdown text={step.text} streaming={streaming && isLastStep} />
                        </div>
                      </Reasoning>
                    );
                  }
                  if (step.name === "bash") {
                    return (
                      <Terminal
                        key={step.callId}
                        command={String(step.args.command ?? "")}
                        output={step.output}
                        status={step.status}
                      />
                    );
                  }
                  const hasDetail = step.images.length > 0 || step.diff !== undefined || step.output !== "";

                  return (
                    <Tool
                      key={step.callId}
                      name={step.name}
                      description={toolDescription(step.args)}
                      input={step.args}
                      status={step.status}
                    >
                      {hasDetail ? (
                        <>
                          {step.images.length > 0 && <TranscriptImages images={step.images} className="mb-2" />}
                          {step.diff !== undefined ? (
                            <ToolDiff diff={step.diff} />
                          ) : step.output !== "" ? (
                            <CodeBlock size="sm">
                              <CodeBlockContent wrap className="max-h-64">
                                {step.output}
                              </CodeBlockContent>
                            </CodeBlock>
                          ) : null}
                        </>
                      ) : undefined}
                    </Tool>
                  );
                })}
              </Trace>
            );
          }
          return <Markdown key={segment.key} text={segment.text} streaming={streaming && isLastSegment} />;
        })}
        {item.ending === "interrupted" && (
          <Badge variant="outline" className="self-start">
            Interrupted
          </Badge>
        )}
        {item.ending === "failed" && (
          <ChatError error={item.error} attempts={item.attempts} historical={item.continued} />
        )}
        {item.ending === "complete" && answer && text !== "" && (
          <MessageFooter className="px-0">
            <CopyAction text={text} />
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
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

function CopyAction({ text, className }: { text: string; className?: string }) {
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

/** Argument context only; tool names are displayed verbatim from the conversation. */
export function toolDescription(args: Record<string, unknown>): string {
  if (typeof args.path === "string") {
    const offset = typeof args.offset === "number" ? args.offset : undefined;
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    const range =
      offset === undefined && limit === undefined
        ? ""
        : `:${offset ?? 1}${limit === undefined ? "" : `-${(offset ?? 1) + limit - 1}`}`;
    return `${args.path}${range}`;
  }
  if (typeof args.command === "string") return args.command;
  if (typeof args.threadId === "number" || typeof args.threadId === "string") return `#${args.threadId}`;
  return Object.keys(args).length === 0 ? "" : JSON.stringify(args);
}

export interface ParsedDiffLine {
  type: "add" | "delete" | "context";
  lineNumber?: string;
  text: string;
}

export function parseDiffLine(raw: string): ParsedDiffLine {
  if (raw.startsWith("+")) {
    const rest = raw.slice(1);
    const match = /^\s*(\d+)?\s*(.*)$/.exec(rest);
    return {
      type: "add",
      lineNumber: match?.[1],
      text: match?.[2] ?? rest,
    };
  }
  if (raw.startsWith("-")) {
    const rest = raw.slice(1);
    const match = /^\s*(\d+)?\s*(.*)$/.exec(rest);
    return {
      type: "delete",
      lineNumber: match?.[1],
      text: match?.[2] ?? rest,
    };
  }
  const match = /^\s*(\d+)?\s*(.*)$/.exec(raw);
  return {
    type: "context",
    lineNumber: match?.[1],
    text: match?.[2] ?? raw,
  };
}

export function ToolDiff({ diff }: { diff: string }) {
  const lines = diff.split("\n").map(parseDiffLine);
  return (
    <CodeBlock size="sm">
      <CodeBlockContent className="max-h-80">
        {lines.map((line, index) => {
          const variant = line.type === "add" ? "added" : line.type === "delete" ? "removed" : "default";
          const display = line.lineNumber ? `${line.lineNumber}  ${line.text}` : line.text;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional
            <CodeBlockLine key={index} variant={variant}>
              {display}
            </CodeBlockLine>
          );
        })}
      </CodeBlockContent>
    </CodeBlock>
  );
}
