import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Item, ItemContent, ItemDescription, ItemGroup } from "@/components/ui/item";
import type { QueuedMessage } from "./transcript.ts";

export interface ChatComposerProps {
  busy: boolean;
  queued: QueuedMessage[];
  /** Rejects when the server refuses the message; the text then stays in the box. */
  onSend: (text: string, whenBusy: "steer" | "followUp") => Promise<void>;
  onStop: () => void;
  autoFocus?: boolean;
  /** Shown under the box: the model, the thinking level, and how full the context is. */
  status?: ReactNode;
}

/**
 * The message box. While the agent works, Enter steers it (the message is read at its next step) and Alt+Enter queues
 * a follow-up for when it is done, as in pi's terminal UI. Shift+Enter starts a new line.
 */
export function ChatComposer({ busy, queued, onSend, onStop, autoFocus, status }: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = value.trim() === "";

  const send = async (whenBusy: "steer" | "followUp"): Promise<void> => {
    const text = value.trim();
    if (text === "" || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(text, whenBusy);
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
    if (busy && empty) onStop();
    else void send("steer");
  };

  return (
    <div className="grid gap-2">
      {queued.length > 0 && (
        <ItemGroup aria-label="Queued messages" className="gap-1">
          {queued.map((message) => (
            <Item key={message.id} size="xs" variant="muted">
              <Badge variant="outline">{message.mode === "steer" ? "Steering" : "Follow-up"}</Badge>
              <ItemContent>
                <ItemDescription className="truncate">{message.text}</ItemDescription>
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
            className="max-h-60 min-h-16"
            aria-label="Message"
            placeholder={busy ? "Steer the agent, or Alt+Enter to queue a follow-up" : "Ask the agent"}
            autoFocus={autoFocus}
          />
          <InputGroupAddon align="block-end">
            {busy && !empty && <InputGroupText>Enter steers · Alt+Enter queues</InputGroupText>}
            {busy && empty ? (
              <InputGroupButton type="submit" variant="default" size="icon-sm" className="ml-auto" aria-label="Stop">
                <SquareIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                className="ml-auto"
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
