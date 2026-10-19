import type { CommentMessage, CommentThread } from "@tandem/contracts";
import { Markdown } from "@/chat/markdown.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { commentPlace } from "./comment-anchor.ts";

/** One message of a thread, with who wrote it and, for a user's message, whether it went to the agent. */
export function ThreadMessage({
  message,
  onEdit,
  onWithdraw,
}: {
  message: CommentMessage;
  onEdit(): void;
  onWithdraw(): void;
}) {
  const waiting = message.author === "user" && message.sent === undefined;
  return (
    <div className="flex flex-col gap-1 border-b px-2.5 py-2 last:border-b-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{message.author === "user" ? "You" : "Agent"}</span>
        {waiting && <Badge variant="outline">Not sent</Badge>}
        {waiting && (
          <span className="ml-auto flex gap-1">
            <Button type="button" size="xs" variant="ghost" onClick={onEdit}>
              Edit
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={onWithdraw}>
              Take back
            </Button>
          </span>
        )}
      </div>
      {message.author === "agent" ? (
        <Markdown text={message.text} />
      ) : (
        <p className="break-words whitespace-pre-wrap">{message.text}</p>
      )}
    </div>
  );
}

/** The code a thread was written on, for a thread whose line is gone: the line marked, with the lines kept around it. */
export function WrittenOnCode({
  thread,
  why,
}: {
  thread: CommentThread;
  why: "outdated" | "removed" | "outside" | "unverified";
}) {
  const { anchor } = thread;
  const first = anchor.line - anchor.before.length;
  const lines = [...anchor.before, anchor.quote, ...anchor.after];
  return (
    <div className="flex flex-col gap-1 border-b px-2.5 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">
          {why === "unverified"
            ? "Location not verified"
            : why === "outdated"
              ? "Outdated"
              : why === "outside"
                ? "Outside this diff"
                : "On a removed line"}
        </Badge>
        <span className="font-mono">{commentPlace(anchor)}</span>
      </div>
      <pre className="overflow-x-auto font-mono text-xs leading-relaxed">
        {lines.map((line, index) => {
          const number = first + index;
          return (
            <div key={number} className={number === anchor.line ? "bg-muted" : "text-muted-foreground"}>
              <span className="inline-block w-10 pr-2 text-right select-none">{number}</span>
              {line}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
