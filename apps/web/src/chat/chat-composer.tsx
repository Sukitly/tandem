import type { ChatStatus } from "ai";
import { ArrowUpIcon } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";
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
        <ul className="grid gap-1 px-2" aria-label="Queued messages">
          {queued.map((message) => (
            <li key={message.id} className="truncate text-muted-foreground text-xs">
              <span className="font-medium">{message.mode === "steer" ? "Steering" : "Follow-up"}:</span> {message.text}
            </li>
          ))}
        </ul>
      )}
      <PromptInput className="chat-composer" onSubmit={() => send("steer")}>
        <div className="flex w-full items-end gap-1">
          <PromptInputTextarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            className="chat-composer-textarea max-h-48 min-h-[42px] min-w-0 overflow-y-auto px-3 py-[9px] leading-6"
            aria-label="Message"
            placeholder={busy ? "Steer the agent, or Alt+Enter to queue a follow-up" : "Ask the agent"}
            rows={1}
            autoFocus={autoFocus}
          />
          <PromptInputSubmit
            className="size-10 shrink-0 rounded-full"
            status={status}
            onStop={onStop}
            disabled={!busy && value.trim() === ""}
          >
            {status === "ready" ? <ArrowUpIcon className="size-5" /> : undefined}
          </PromptInputSubmit>
        </div>
      </PromptInput>
      {error !== null && (
        <p role="alert" className="px-2 text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
