import {
  AlertCircleIcon,
  BanIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleIcon,
  CopyIcon,
  FilePenLineIcon,
  FilePlusIcon,
  FileTextIcon,
  MessageSquareReplyIcon,
  SparklesIcon,
  SquareChevronRightIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block.tsx";
import { Markdown } from "./markdown.tsx";
import type { AssistantPart, ToolStatus, TranscriptItem } from "./transcript.ts";
import { TranscriptImages } from "./transcript-images.tsx";

type ToolPart = Extract<AssistantPart, { kind: "tool" }>;

export function TranscriptEntry({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "user":
      // Markdown, like an answer: a message that carries review comments names the places it is about as links.
      return (
        <div className="group/message flex flex-col items-end gap-1">
          <TranscriptImages images={item.images} className="max-w-[85%] justify-end" />
          {item.text !== "" && (
            <div className="max-w-[85%] rounded-2xl border border-border/40 bg-muted/70 px-4 py-2.5 break-words">
              <Markdown text={item.text} />
            </div>
          )}
          {item.text !== "" && <CopyButton text={item.text} />}
        </div>
      );
    case "assistant":
      return <AssistantMessage item={item} />;
    case "compaction":
      return (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Separator className="flex-1" />
          Older messages were summarized
          <Separator className="flex-1" />
        </div>
      );
    case "compacting":
      return (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <WaitingDots label="Compacting the conversation" />
          Compacting the conversation
        </div>
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

function AssistantMessage({ item }: { item: Extract<TranscriptItem, { kind: "assistant" }> }) {
  const streaming = item.ending === "streaming";
  const text = item.parts.flatMap((part) => (part.kind === "text" ? [part.text] : [])).join("\n\n");
  // A message that calls tools is a step on the way; copying is for answers.
  const answer = !item.parts.some((part) => part.kind === "tool");
  return (
    <div className="group/message flex flex-col gap-3">
      {item.parts.map((part, index) => {
        const last = index === item.parts.length - 1;
        if (part.kind === "tool") return <ToolCall key={part.callId} part={part} />;
        if (part.kind === "thinking") {
          // biome-ignore lint/suspicious/noArrayIndexKey: parts only grow at the end, so positions are stable.
          return <Thought key={index} text={part.text} active={streaming && last} />;
        }
        // biome-ignore lint/suspicious/noArrayIndexKey: see above.
        return <Markdown key={index} text={part.text} streaming={streaming && last} />;
      })}
      {item.ending === "interrupted" && (
        <Badge variant="outline" className="self-start">
          Interrupted
        </Badge>
      )}
      {item.ending === "failed" && <ChatError error={item.error} attempts={item.attempts} />}
      {item.ending === "complete" && answer && text !== "" && (
        <div className="flex items-center gap-1.5 pt-1 text-muted-foreground">
          <CopyButton text={text} className="self-start" />
        </div>
      )}
    </div>
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
        {error !== undefined && error !== "" && (
          <CopyButton
            text={error}
            className="opacity-0 group-hover/error:opacity-100 group-hover/message:opacity-100 focus-visible:opacity-100"
          />
        )}
      </div>
      {error !== undefined && error !== "" && (
        <p className="text-xs text-muted-foreground leading-relaxed break-words">{error}</p>
      )}
    </div>
  );
}

/** A collapsed row that opens to show details: the shape shared by thoughts and tool calls. */
function Disclosure({
  icon,
  summary,
  status,
  children,
}: {
  icon: ReactNode;
  summary: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible className="group/disclosure min-w-0">
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="flex w-full min-w-0 cursor-pointer items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0"
          />
        }
      >
        {status}
        {icon}
        <span className="min-w-0 truncate">{summary}</span>
        <ChevronRightIcon className="transition-transform group-data-[open]/disclosure:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 ml-2 border-l pl-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function Thought({ text, active }: { text: string; active: boolean }) {
  return (
    <Disclosure icon={<SparklesIcon />} summary={active ? "Thinking…" : "Thought"}>
      <div className="text-sm text-muted-foreground">
        <Markdown text={text} streaming={active} />
      </div>
    </Disclosure>
  );
}

function ToolCall({ part }: { part: ToolPart }) {
  const { icon, summary } = describeTool(part);
  const body = part.name === "write" && typeof part.args.content === "string" ? part.args.content : part.output;
  return (
    <Disclosure
      icon={icon}
      summary={<span className="font-mono">{summary}</span>}
      status={<StatusIcon status={part.status} />}
    >
      {part.images.length > 0 && <TranscriptImages images={part.images} className="mb-2" />}
      {part.diff !== undefined ? (
        <Diff diff={part.diff} />
      ) : part.name === "reply_to_comment" &&
        (part.status === "running" || part.status === "done") &&
        typeof part.args.text === "string" ? (
        // What the agent wrote on the thread, as the thread shows it. A refused reply shows why instead, and a call
        // that never ran shows nothing it did not write.
        <div className="text-sm">
          <Markdown text={part.args.text} streaming={part.status === "running"} />
        </div>
      ) : body !== "" ? (
        <CodeBlock code={body} language={languageOf(part)} streaming={part.status === "running"} tall />
      ) : part.images.length > 0 ? null : (
        <p className="text-sm text-muted-foreground">{part.status === "running" ? "Running…" : "No output"}</p>
      )}
    </Disclosure>
  );
}

function StatusIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case "pending":
      return <CircleIcon aria-label="Waiting" />;
    case "running":
      return <Spinner aria-label="Running" />;
    case "done":
      return <CheckIcon aria-label="Done" />;
    case "failed":
      return <XIcon aria-label="Failed" className="text-destructive" />;
    case "cancelled":
      return <BanIcon aria-label="Cancelled" />;
  }
}

/** The edit tool's diff: one line per change, `+`/`-`/space, the line number, and the text. */
function Diff({ diff }: { diff: string }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-xl border border-border/50 bg-muted/40 py-3 font-mono text-xs">
      {diff.split("\n").map((line, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a finished diff never changes.
          key={index}
          className={cn(
            "px-3 whitespace-pre-wrap",
            line.startsWith("+") && "bg-green-500/15 text-green-700 dark:text-green-400",
            line.startsWith("-") && "bg-red-500/15 text-red-700 dark:text-red-400",
          )}
        >
          {line}
        </div>
      ))}
    </pre>
  );
}

/** The language of what a file tool shows, from the file's extension; Shiki knows most extensions by name. */
function languageOf(part: ToolPart): string | undefined {
  if (part.name !== "read" && part.name !== "write") return undefined;
  const path = typeof part.args.path === "string" ? part.args.path : "";
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return extension;
}

/** The icon and one-line summary of a tool call, as pi's terminal shows them. */
function describeTool(part: ToolPart): { icon: ReactNode; summary: string } {
  const path = typeof part.args.path === "string" ? part.args.path : "";
  switch (part.name) {
    case "bash":
      return { icon: <SquareChevronRightIcon />, summary: String(part.args.command ?? "") };
    case "read": {
      const offset = typeof part.args.offset === "number" ? part.args.offset : undefined;
      const limit = typeof part.args.limit === "number" ? part.args.limit : undefined;
      const range =
        offset === undefined && limit === undefined
          ? ""
          : `:${offset ?? 1}${limit === undefined ? "" : `-${(offset ?? 1) + limit - 1}`}`;
      return { icon: <FileTextIcon />, summary: `${path}${range}` };
    }
    case "edit":
      return { icon: <FilePenLineIcon />, summary: path };
    case "write":
      return { icon: <FilePlusIcon />, summary: path };
    case "reply_to_comment":
      return { icon: <MessageSquareReplyIcon />, summary: `Comment #${String(part.args.threadId ?? "")}` };
    default:
      return { icon: <WrenchIcon />, summary: `${part.name} ${JSON.stringify(part.args)}` };
  }
}

/** Copies a message. Shows while the pointer is over the message, or when it has keyboard focus. */
function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={cn(
        "text-muted-foreground hover:text-foreground opacity-0 group-hover/message:opacity-100 focus-visible:opacity-100 transition-opacity",
        className,
      )}
      aria-label={copied ? "Copied" : "Copy"}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-green-600 dark:text-green-400" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </Button>
  );
}
