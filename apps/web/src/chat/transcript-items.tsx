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
  SparklesIcon,
  SquareChevronRightIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block.tsx";
import { Markdown } from "./markdown.tsx";
import type { AssistantPart, ToolStatus, TranscriptItem } from "./transcript.ts";

type ToolPart = Extract<AssistantPart, { kind: "tool" }>;

export function TranscriptEntry({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="ml-auto max-w-[85%] rounded-lg bg-muted px-4 py-2.5 break-words whitespace-pre-wrap">
          {item.text}
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
    <div className="flex flex-col gap-3">
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
        <div>
          <Badge variant="outline">Interrupted</Badge>
        </div>
      )}
      {item.ending === "failed" && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>The answer failed</AlertTitle>
          {item.error !== undefined && <AlertDescription>{item.error}</AlertDescription>}
        </Alert>
      )}
      {item.ending === "complete" && answer && text !== "" && <CopyButton text={text} />}
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
      {part.diff !== undefined ? (
        <Diff diff={part.diff} />
      ) : body !== "" ? (
        <CodeBlock code={body} language={languageOf(part)} streaming={part.status === "running"} tall />
      ) : (
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
    <pre className="max-h-80 overflow-auto rounded-md bg-muted py-3 font-mono text-xs">
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
    default:
      return { icon: <WrenchIcon />, summary: `${part.name} ${JSON.stringify(part.args)}` };
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? "Copied" : "Copy"}
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}
