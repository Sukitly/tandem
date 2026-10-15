import { FilePenLineIcon, FilePlusIcon, FileTextIcon, MessageSquareReplyIcon, WrenchIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { CodeBlock, CodeBlockContent, CodeBlockLine } from "@/components/ui/code-block.tsx";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace.tsx";

export interface ToolProps {
  name: string;
  args?: Record<string, unknown>;
  output?: string;
  diff?: string;
  status: "pending" | "running" | "done" | "error" | "failed" | "cancelled";
  defaultOpen?: boolean;
  children?: ReactNode;
}

function toolMeta(
  name: string,
  args?: Record<string, unknown>,
  status?: ToolProps["status"],
): { icon: ReactNode; title: string } {
  const path = typeof args?.path === "string" ? args.path : "";
  const running = status === "running";
  const failed = status === "error" || status === "failed";
  const cancelled = status === "cancelled";

  switch (name) {
    case "read": {
      const offset = typeof args?.offset === "number" ? args.offset : undefined;
      const limit = typeof args?.limit === "number" ? args.limit : undefined;
      const range =
        offset === undefined && limit === undefined
          ? ""
          : `:${offset ?? 1}${limit === undefined ? "" : `-${(offset ?? 1) + limit - 1}`}`;
      const verb = cancelled ? "Cancelled reading" : failed ? "Failed to read" : running ? "Reading" : "Read";
      return { icon: <FileTextIcon />, title: `${verb} ${path}${range}` };
    }
    case "edit": {
      const verb = cancelled ? "Cancelled editing" : failed ? "Failed to edit" : running ? "Editing" : "Edited";
      return { icon: <FilePenLineIcon />, title: `${verb} ${path}` };
    }
    case "write": {
      const verb = cancelled ? "Cancelled writing" : failed ? "Failed to write" : running ? "Writing" : "Wrote";
      return { icon: <FilePlusIcon />, title: `${verb} ${path}` };
    }
    case "reply_to_comment": {
      const id = String(args?.threadId ?? "");
      const verb = cancelled
        ? "Cancelled reply to comment"
        : failed
          ? "Failed to reply to comment"
          : running
            ? "Replying to comment"
            : "Replied to comment";
      return { icon: <MessageSquareReplyIcon />, title: `${verb} #${id}` };
    }
    default: {
      const verb = cancelled ? "Cancelled calling" : failed ? "Failed to call" : running ? "Calling" : "Called";
      return { icon: <WrenchIcon />, title: `${verb} ${name}` };
    }
  }
}

/**
 * Tool displays a tool call the agent makes, from input to output.
 * Follows the shadcn/ui AI Elements Tool pattern.
 */
export function Tool({ name, args, output = "", diff, status, defaultOpen, children }: ToolProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { icon, title } = toolMeta(name, args, status);
  const running = status === "running";
  const failed = status === "error" || status === "failed";
  const traceStatus: "running" | "error" | "pending" | undefined = running
    ? "running"
    : failed
      ? "error"
      : status === "pending"
        ? "pending"
        : undefined;

  const displayBody = name === "write" && typeof args?.content === "string" ? args.content : output;
  const hasDetail = diff !== undefined || displayBody.length > 0 || children !== undefined;

  const line = (
    <TraceLine status={traceStatus}>
      <TraceIcon>{icon}</TraceIcon>
      <TraceTitle>{title}</TraceTitle>
    </TraceLine>
  );

  if (!hasDetail) {
    return line;
  }

  return (
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        {children}
        {diff !== undefined ? (
          <CodeBlock size="sm">
            <CodeBlockContent className="max-h-80">
              {diff.split("\n").map((diffLine, index) => {
                const isAdded = diffLine.startsWith("+");
                const isRemoved = diffLine.startsWith("-");
                const variant = isAdded ? "added" : isRemoved ? "removed" : "default";
                const content = isAdded || isRemoved ? diffLine.slice(1) : diffLine;
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: lines in diff are stable
                  <CodeBlockLine key={index} variant={variant}>
                    {content}
                  </CodeBlockLine>
                );
              })}
            </CodeBlockContent>
          </CodeBlock>
        ) : displayBody ? (
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-64">
              {displayBody}
            </CodeBlockContent>
          </CodeBlock>
        ) : null}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
