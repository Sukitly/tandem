import type { MessageDraft } from "@/app/message-draft.ts";
import { imageFiles } from "./attached-images.ts";
import type { ImageSupport } from "./chat-composer.tsx";
import type { SendMode } from "./composer-options.tsx";

/**
 * Attaches the files a paste, a drop or the file picker handed over. Only images are taken, and only by a model that
 * takes them; otherwise the box says why, so that a file dropped on it is never silently ignored.
 */
export async function attachFiles(draft: MessageDraft, imageSupport: ImageSupport, files: File[]): Promise<void> {
  if (files.length === 0) return;
  if (imageSupport.kind !== "accepted") {
    draft.setError(
      imageSupport.kind === "none"
        ? "The current model does not take images. Choose one that does."
        : "Choose an available model before sending images.",
    );
    return;
  }
  const images = imageFiles(files);
  if (images.length === 0) {
    draft.setError("Only images can be attached.");
    return;
  }
  await draft.attach(images, imageSupport.maxPerMessage);
}

/**
 * What the one button of the box offers, by what the agent is doing and how a message would be sent: Stop while the
 * agent works and the box is empty (Escape stops it with a message in the box too), otherwise Send.
 */
export function submitTitle(busy: boolean, empty: boolean, sendMode: SendMode): string {
  if (busy && empty) return "Stop (Esc)";
  return busy && sendMode === "followUp" ? "Queue follow-up" : "Send";
}

/** What the box asks for, by what the agent is doing and how a message would be sent. */
export function placeholderOf(busy: boolean, sendMode: SendMode, mobile = false): string {
  if (!busy) return "Ask the agent";
  if (sendMode === "followUp") return "Queue a follow-up";
  // A phone has no Alt+Enter; its send mode is chosen in the composer options.
  return mobile ? "Steer the agent" : "Steer the agent, or Alt+Enter to queue a follow-up";
}
