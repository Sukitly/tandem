import { XIcon } from "lucide-react";
import { PromptInputAttachments } from "@/components/ai-elements/prompt-input.tsx";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import type { AttachedImage } from "./attached-images.ts";

export function ComposerAttachments({
  attached,
  onDetach,
}: {
  attached: readonly AttachedImage[];
  onDetach(id: number): void;
}) {
  if (attached.length === 0) return null;
  return (
    <PromptInputAttachments className="max-h-[10dvh] overflow-y-auto overscroll-contain">
      {attached.map((image) => (
        <Attachment key={image.id} size="sm">
          <AttachmentMedia variant="image">
            <img src={image.url} alt={image.name} className="size-full object-cover" />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{image.name}</AttachmentTitle>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction aria-label={`Remove ${image.name}`} onClick={() => onDetach(image.id)}>
              <XIcon />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ))}
    </PromptInputAttachments>
  );
}
