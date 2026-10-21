import { BrainIcon, TerminalIcon } from "lucide-react";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/agent/reasoning.tsx";
import { ToolCall, ToolCallBlock, ToolCallContent, ToolCallTrigger } from "@/components/agent/tool-call.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { CopyableCode } from "./copyable-code.tsx";
import { fileToolBody, isFileTool } from "./file-tool-body.tsx";
import { Markdown } from "./markdown.tsx";
import { toolDescription } from "./tool-description.ts";
import type { AssistantPart, ToolStatus } from "./transcript.ts";
import { TranscriptImages } from "./transcript-images.tsx";

type ThinkingPart = Extract<AssistantPart, { kind: "thinking" }>;
type ToolPart = Extract<AssistantPart, { kind: "tool" }>;

/** Tandem's names for where a call is, in the names of `ToolCall`. */
const CALL_STATUS = {
  pending: "pending",
  running: "running",
  done: "success",
  failed: "error",
  cancelled: "cancelled",
} as const satisfies Record<ToolStatus, string>;

/** The word at the end of the line for a call that did not finish; the others say it with their icon. */
function statusWord(status: ToolStatus): "failed" | "cancelled" | undefined {
  return status === "failed" || status === "cancelled" ? status : undefined;
}

/** The backend's name for the tool, verbatim, in a badge that truncates and shows the whole name on hover. */
function NameBadge({ name }: { name: string }) {
  return (
    <Badge variant="outline" className="max-w-48 min-w-0 font-mono" title={name}>
      <span className="truncate">{name}</span>
    </Badge>
  );
}

/** The model's thinking: open while it streams, then a line that opens to the text, drawn as Markdown. */
export function ThinkingStep({ step, streaming }: { step: ThinkingPart; streaming: boolean }) {
  return (
    <Reasoning streaming={streaming} icon={<BrainIcon />}>
      <ReasoningTrigger />
      <ReasoningContent>
        <div className="text-sm text-muted-foreground">
          <Markdown text={step.text} streaming={streaming} />
        </div>
      </ReasoningContent>
    </Reasoning>
  );
}

/** A tool call, by what the call is: a command, a change to a file, or any other tool. */
export function ToolStep({ step }: { step: ToolPart }) {
  if (step.name === "bash") return <BashStep step={step} />;
  if (isFileTool(step)) return <FileToolStep step={step} />;
  return <GenericToolStep step={step} />;
}

/** Units of the bash tool's numeric arguments, which the backend states only in the argument's description. */
const OPTION_UNITS: Record<string, string> = { timeout: "s" };

function formatOption(key: string, value: unknown): string {
  if (typeof value === "number") return `${value}${OPTION_UNITS[key] ?? ""}`;
  return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
}

/**
 * A command and what it printed. The line is the badge and the command, truncated; opened, one box holds the whole
 * command with the call's other arguments, and under a divider the output. The copy button of the command copies the
 * command alone, without its prompt.
 */
function BashStep({ step }: { step: ToolPart }) {
  const { command, ...options } = step.args;
  const text = String(command ?? "");
  const optionEntries = Object.entries(options);
  const hasInput = text.length > 0 || optionEntries.length > 0;
  return (
    <ToolCall
      status={CALL_STATUS[step.status]}
      // A running call shows its spinner, which a given icon would replace.
      icon={step.status === "running" ? undefined : <TerminalIcon />}
      expandable={hasInput || step.output.length > 0}
    >
      <ToolCallTrigger
        summary={text === "" ? undefined : <span className="font-mono text-muted-foreground">{text}</span>}
        description={statusWord(step.status)}
      >
        <NameBadge name={step.name} />
      </ToolCallTrigger>
      <ToolCallContent layout="joined">
        {hasInput && (
          // A box of its own, so that its copy button is the command's.
          <CopyableCode value={text} label="Copy command" className="max-h-40">
            {text.length > 0 && (
              <span>
                <span aria-hidden="true" className="text-muted-foreground select-none">
                  {"$ "}
                </span>
                {text}
              </span>
            )}
            {optionEntries.length > 0 && (
              <span
                data-slot="terminal-options"
                className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground"
              >
                {optionEntries.map(([key, value]) => (
                  <span key={key}>
                    {key} <span className="text-foreground">{formatOption(key, value)}</span>
                  </span>
                ))}
              </span>
            )}
          </CopyableCode>
        )}
        {step.output.length > 0 && <ToolCallBlock code={step.output} />}
      </ToolCallContent>
    </ToolCall>
  );
}

/** An edit or a write: what the call changed is shown in place of its arguments, which hold the same text as JSON. */
function FileToolStep({ step }: { step: ToolPart }) {
  const body = fileToolBody(step);
  return (
    <ToolCall status={CALL_STATUS[step.status]} expandable={body !== undefined}>
      <ToolCallTrigger summary={toolDescription(step.args) || undefined} description={statusWord(step.status)}>
        <NameBadge name={step.name} />
      </ToolCallTrigger>
      <ToolCallContent>{body}</ToolCallContent>
    </ToolCall>
  );
}

/** Any other tool: the arguments as JSON, then what the call returned, its images and its text. */
function GenericToolStep({ step }: { step: ToolPart }) {
  return (
    <ToolCall status={CALL_STATUS[step.status]}>
      <ToolCallTrigger summary={toolDescription(step.args) || undefined} description={statusWord(step.status)}>
        <NameBadge name={step.name} />
      </ToolCallTrigger>
      <ToolCallContent>
        <ToolCallBlock label="Input" code={JSON.stringify(step.args, null, 2)} />
        {step.images.length > 0 && <TranscriptImages images={step.images} />}
        {step.output !== "" && <ToolCallBlock label="Output" code={step.output} />}
      </ToolCallContent>
    </ToolCall>
  );
}
