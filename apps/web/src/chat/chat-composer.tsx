import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from "react";
import { CommentList } from "@/comments/comment-list.tsx";
import type { WaitingComment } from "@/comments/project-comments.ts";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Item, ItemContent, ItemDescription, ItemGroup } from "@/components/ui/item";
import type { QueuedMessage } from "./transcript.ts";

export interface ChatComposerProps {
  busy: boolean;
  queued: QueuedMessage[];
  /** Comments of the project waiting to be sent; they go with the message, which the server writes them into. */
  comments?: WaitingComment[];
  onWithdrawComment?(comment: WaitingComment): void;
  /** Rejects when the server refuses the message; the text then stays in the box, and the comments wait. */
  onSend: (text: string, comments: number[], whenBusy: "steer" | "followUp") => Promise<void>;
  onStop: () => void;
  autoFocus?: boolean;
  /** Shown under the box: the model, the thinking level, and how full the context is. */
  status?: ReactNode;
}

/**
 * The message box. While the agent works, Enter steers it (the message is read at its next step) and Alt+Enter queues
 * a follow-up for when it is done, as in pi's terminal UI. Shift+Enter starts a new line.
 */
export function ChatComposer({
  busy,
  queued,
  comments = [],
  onWithdrawComment,
  onSend,
  onStop,
  autoFocus,
  status,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = value.trim() === "" && comments.length === 0;

  const send = async (whenBusy: "steer" | "followUp"): Promise<void> => {
    if (empty || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(
        value,
        comments.map((comment) => comment.messageId),
        whenBusy,
      );
      setValue("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send(event.altKey ? "followUp" : "steer");
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void send("steer");
  };

  return (
    <div className="grid min-w-0 gap-2">
      <CommentList comments={comments} onWithdraw={(comment) => onWithdrawComment?.(comment)} />
      {queued.length > 0 && (
        <ItemGroup aria-label="Queued messages" className="gap-1">
          {queued.map((message) => (
            <Item key={message.id} size="xs" variant="muted">
              <Badge variant="outline">{message.mode === "steer" ? "Steering" : "Follow-up"}</Badge>
              <ItemContent className="min-w-0">
                <ItemDescription className="line-clamp-none whitespace-pre-wrap wrap-anywhere">
                  {message.text}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      )}
      <form onSubmit={onSubmit}>
        <InputGroup>
          <InputGroupTextarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            className="max-h-60 min-h-0 py-2.5"
            aria-label="Message"
            placeholder={busy ? "Steer the agent, or Alt+Enter to queue a follow-up" : "Ask the agent"}
            autoFocus={autoFocus}
          />
          <InputGroupAddon align="inline-end" className="self-end pb-1.5">
            {busy && empty ? (
              <InputGroupButton type="button" variant="default" size="icon-sm" aria-label="Stop" onClick={onStop}>
                <SquareIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                aria-label="Send"
                disabled={empty || sending}
              >
                <ArrowUpIcon />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
      {status}
      {error !== null && <FieldError>{error}</FieldError>}
    </div>
  );
}
