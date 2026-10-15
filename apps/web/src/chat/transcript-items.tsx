import {
  AlertCircleIcon,
  CheckIcon,
  CopyIcon,
  FilePenLineIcon,
  FilePlusIcon,
  FileTextIcon,
  MessageSquareReplyIcon,
  WrenchIcon,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { MessageAction, Reasoning, Terminal, Tool } from "@/components/ai-elements/index.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Bubble, BubbleContent } from "@/components/ui/bubble.tsx";
import { CodeBlock, CodeBlockContent, CodeBlockLine } from "@/components/ui/code-block.tsx";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker.tsx";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Trace } from "@/components/ui/trace.tsx";
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
                  const { icon, title } = describeTool(step);
                  const writeContent =
                    step.name === "write" && typeof step.args.content === "string" ? step.args.content : undefined;
                  const hasDetail =
                    step.images.length > 0 ||
                    step.diff !== undefined ||
                    writeContent !== undefined ||
                    (step.name === "reply_to_comment" && typeof step.args.text === "string") ||
                    step.output !== "";

                  return (
                    <Tool key={step.callId} title={title} icon={icon} status={step.status}>
                      {hasDetail ? (
                        <>
                          {step.images.length > 0 && <TranscriptImages images={step.images} className="mb-2" />}
                          {step.name === "reply_to_comment" && typeof step.args.text === "string" && (
                            <div className="text-sm">
                              <Markdown text={step.args.text} streaming={step.status === "running"} />
                            </div>
                          )}
                          {step.diff !== undefined ? (
                            <ToolDiff diff={step.diff} />
                          ) : writeContent !== undefined ? (
                            <CodeBlock size="sm">
                              <CodeBlockContent wrap className="max-h-64">
                                {writeContent}
                              </CodeBlockContent>
                            </CodeBlock>
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
        {item.ending === "failed" && <ChatError error={item.error} attempts={item.attempts} />}
        {item.ending === "complete" && answer && text !== "" && (
          <MessageFooter className="px-0">
            <CopyAction text={text} />
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

/** A compact, subtle error callout for failed model generations or chat notices. */
export function ChatError({
  title = "Answer failed",
  error,
  attempts,
  className,
}: {
  title?: string;
  error?: string;
  attempts?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group/error group/message flex w-full max-w-xl flex-col gap-1.5 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm dark:bg-destructive/10",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertCircleIcon className="size-4 shrink-0 text-destructive" />
          <span className="font-medium text-foreground">{title}</span>
          {attempts !== undefined && attempts > 1 && (
            <Badge variant="outline" className="border-destructive/30 px-1.5 py-0 text-[10px] text-muted-foreground">
              {attempts} attempts
            </Badge>
          )}
        </div>
        {error !== undefined && error !== "" && <CopyAction text={error} />}
      </div>
      {error !== undefined && error !== "" && (
        <p className="text-xs text-muted-foreground leading-relaxed break-words">{error}</p>
      )}
    </div>
  );
}

function CopyAction({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <MessageAction
      label={copied ? "Copied" : "Copy"}
      className={className}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </MessageAction>
  );
}

export function describeTool(part: {
  name: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "done" | "error" | "failed" | "cancelled";
}): { icon: React.ReactNode; title: string } {
  const path = typeof part.args.path === "string" ? part.args.path : "";
  const running = part.status === "running";
  const failed = part.status === "error" || part.status === "failed";
  const cancelled = part.status === "cancelled";

  switch (part.name) {
    case "read": {
      const offset = typeof part.args.offset === "number" ? part.args.offset : undefined;
      const limit = typeof part.args.limit === "number" ? part.args.limit : undefined;
      const range =
        offset === undefined && limit === undefined
          ? ""
          : `:${offset ?? 1}${limit === undefined ? "" : `-${(offset ?? 1) + limit - 1}`}`;
      const verb = cancelled ? "Cancelled reading" : failed ? "Failed to read" : running ? "Reading" : "Read";
      return { icon: <FileTextIcon className="size-4" />, title: `${verb} ${path}${range}` };
    }
    case "edit": {
      const verb = cancelled ? "Cancelled editing" : failed ? "Failed to edit" : running ? "Editing" : "Edited";
      return { icon: <FilePenLineIcon className="size-4" />, title: `${verb} ${path}` };
    }
    case "write": {
      const verb = cancelled ? "Cancelled writing" : failed ? "Failed to write" : running ? "Writing" : "Wrote";
      return { icon: <FilePlusIcon className="size-4" />, title: `${verb} ${path}` };
    }
    case "reply_to_comment": {
      const id = String(part.args.threadId ?? "");
      const verb = cancelled
        ? "Cancelled reply to comment"
        : failed
          ? "Failed to reply to comment"
          : running
            ? "Replying to comment"
            : "Replied to comment";
      return { icon: <MessageSquareReplyIcon className="size-4" />, title: `${verb} #${id}` };
    }
    default: {
      const verb = cancelled ? "Cancelled calling" : failed ? "Failed to call" : running ? "Calling" : "Called";
      return { icon: <WrenchIcon className="size-4" />, title: `${verb} ${part.name}` };
    }
  }
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
