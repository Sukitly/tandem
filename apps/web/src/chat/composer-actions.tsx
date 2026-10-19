import { ArrowUpIcon, PlusIcon, SquareIcon } from "lucide-react";
import type { RefObject } from "react";
import { PromptInputActionButton, PromptInputSubmitButton } from "@/components/ai-elements/index.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IMAGE_ACCEPT } from "./attached-images.ts";
import type { SendMode } from "./composer-options.tsx";

/** The control that picks images from the device; they can also be pasted or dropped. */
export function AttachImages({
  picker,
  onAttach,
}: {
  picker: RefObject<HTMLInputElement | null>;
  onAttach(files: File[]): Promise<void>;
}) {
  return (
    <>
      <input
        ref={picker}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          void onAttach([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <PromptInputActionButton type="button" aria-label="Attach images" onClick={() => picker.current?.click()} />
          }
        >
          <PlusIcon />
        </TooltipTrigger>
        <TooltipContent>Attach images, or paste or drop them</TooltipContent>
      </Tooltip>
    </>
  );
}

/**
 * Stop or Send. While the agent works, an empty box offers Stop and a message offers Send, which steers or queues it. A
 * message being sent offers Stop too, as Send cannot be pressed again; Escape stops whatever the box holds.
 */
export function SubmitOrStop({
  busy,
  empty,
  sending,
  stopping,
  sendMode,
  onStop,
}: {
  busy: boolean;
  empty: boolean;
  sending: boolean;
  stopping: boolean;
  sendMode: SendMode;
  onStop(): void;
}) {
  if (busy && (empty || sending)) {
    return (
      <PromptInputSubmitButton type="button" aria-label="Stop" title="Stop (Esc)" disabled={stopping} onClick={onStop}>
        <SquareIcon />
      </PromptInputSubmitButton>
    );
  }
  return (
    <PromptInputSubmitButton
      type="submit"
      aria-label="Send"
      title={busy && sendMode === "followUp" ? "Queue follow-up" : "Send"}
      disabled={empty || sending}
    >
      <ArrowUpIcon />
    </PromptInputSubmitButton>
  );
}

/** What the box asks for, by what the agent is doing and how a message would be sent. */
export function placeholderOf(busy: boolean, sendMode: SendMode, mobile = false): string {
  if (!busy) return "Ask the agent";
  if (sendMode === "followUp") return "Queue a follow-up";
  // A phone has no Alt+Enter; its send mode is chosen in the composer options.
  return mobile ? "Steer the agent" : "Steer the agent, or Alt+Enter to queue a follow-up";
}
