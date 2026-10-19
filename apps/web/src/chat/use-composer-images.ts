import { type ClipboardEvent, type DragEvent, useRef, useState } from "react";
import type { MessageDraft } from "@/app/message-draft.ts";
import { imageFiles } from "./attached-images.ts";
import type { ImageSupport } from "./chat-composer.tsx";

/** All image entry points share validation, serialization and object-URL ownership in the draft. */
export function useComposerImages(draft: MessageDraft, imageSupport: ImageSupport) {
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const attach = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    if (imageSupport.kind !== "accepted") {
      draft.setError(
        imageSupport.kind === "none"
          ? "The current model does not take images. Choose one that does."
          : "Choose an available model before sending images.",
      );
      return;
    }
    await draft.attach(files, imageSupport.maxPerMessage);
  };

  // A pasted image is attached; pasted text goes into the box as usual.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = imageFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void attach(files);
  };

  const onDragOver = (event: DragEvent<HTMLFormElement>): void => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragging(true);
  };

  const onDrop = (event: DragEvent<HTMLFormElement>): void => {
    setDragging(false);
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    void attach(imageFiles(event.dataTransfer));
  };

  return { dragging, picker, attach, onPaste, onDragOver, onDrop, onDragLeave: () => setDragging(false) };
}
