import type { ChatStatus } from "ai";
import { ArrowUpIcon } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemGroup } from "@/components/ui/item";
import type { QueuedMessage } from "./transcript.ts";

export interface ChatComposerProps {
  busy: boolean;
  queued: QueuedMessage[];
  /** Rejects when the server refuses the message; the text then stays in the box. */
  onSend: (text: string, whenBusy: "steer" | "followUp") => Promise<void>;
  onStop: () => void;
  autoFocus?: boolean;
}

/**
 * The message box. While the agent works, Enter steers it (the message is read at its next step) and Alt+Enter queues
 * a follow-up for when it is done, as in pi's terminal UI.
 */
export function ChatComposer({ busy, queued, onSend, onStop, autoFocus }: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (event.key !== "Enter" || !event.altKey || event.nativeEvent.isComposing) return;
    // Handled here, so the box does not also submit it as a plain Enter.
    event.preventDefault();
    void send("followUp");
  };

  const status: ChatStatus = busy ? "streaming" : sending ? "submitted" : "ready";

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
      <PromptInput onSubmit={() => send("steer")}>
        <PromptInputBody>
          <PromptInputTextarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            className="max-h-48"
            aria-label="Message"
            placeholder={busy ? "Steer the agent, or Alt+Enter to queue a follow-up" : "Ask the agent"}
            autoFocus={autoFocus}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit status={status} onStop={onStop} disabled={!busy && value.trim() === ""}>
            {status === "ready" ? <ArrowUpIcon /> : undefined}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
      {error !== null && <FieldError>{error}</FieldError>}
    </div>
  );
}
