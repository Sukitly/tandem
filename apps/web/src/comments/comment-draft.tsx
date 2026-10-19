import { type RefObject, useRef, useSyncExternalStore } from "react";
import { useDrafts, useTextDraft } from "@/app/drafts.tsx";
import type { TextDraft } from "@/app/text-draft.ts";
import { FieldError } from "@/components/ui/field.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group.tsx";
import { useCompositionGuard } from "@/hooks/use-composition-guard.ts";
import { useCommentWidth } from "./use-comment-width.ts";

export const COMMENT_SURFACE = "m-2 rounded-lg border border-input font-sans dark:bg-input/30";

/** The box a comment is written in: a new thread, a reply, or an edit of a message that is still waiting. */
export function CommentDraft({
  model,
  canSave = true,
  draftKey,
  place,
  view,
  className,
  initial = "",
  submitLabel = "Comment",
  embedded = false,
  onSave,
  onCancel,
}: {
  model?: TextDraft;
  canSave?: boolean;
  draftKey?: string;
  place?: string;
  view?: RefObject<HTMLDivElement | null>;
  className?: string;
  initial?: string;
  submitLabel?: string;
  embedded?: boolean;
  onSave(text: string): Promise<unknown>;
  onCancel(): void;
}) {
  const drafts = useDrafts();
  const localDraft = useTextDraft(draftKey, initial);
  const draft = model ?? localDraft;
  const { text, sending: saving, error } = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  const composition = useCompositionGuard();
  const box = useCommentBox(embedded ? undefined : view);
  const empty = text.trim() === "";

  const save = (): void => {
    if (empty || saving || !canSave) return;
    void draft
      .send(() => onSave(text.trim()))
      .then((saved) => {
        if (saved && draftKey !== undefined && draft.getSnapshot().text === "") drafts?.forgetText(draftKey, draft);
      });
  };

  const cancel = (): void => {
    if (saving) return;
    if (model === undefined) {
      if (draftKey !== undefined && drafts !== null) drafts.forgetText(draftKey, draft);
      else draft.reset();
    }
    onCancel();
  };

  const group = (
    <InputGroup
      ref={box.element}
      className={embedded ? undefined : `${COMMENT_SURFACE} ${className ?? ""}`}
      style={box.style}
    >
      {place !== undefined && (
        <InputGroupAddon align="block-start" className="border-b">
          <InputGroupText className="font-mono text-xs">{place}</InputGroupText>
        </InputGroupAddon>
      )}
      <InputGroupTextarea
        autoFocus
        rows={3}
        value={text}
        aria-label="Comment"
        placeholder="What should change here?"
        className="min-h-20 max-h-[35dvh] overflow-y-auto"
        disabled={saving}
        onChange={(event) => draft.setText(event.target.value)}
        onCompositionStart={composition.onCompositionStart}
        onCompositionEnd={composition.onCompositionEnd}
        onKeyDown={(event) => {
          if (composition.owns(event)) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
      />
      <InputGroupAddon align="block-end" className="justify-end border-t">
        <InputGroupButton size="xs" variant="outline" disabled={saving} onClick={cancel}>
          Cancel
        </InputGroupButton>
        <InputGroupButton size="xs" variant="default" disabled={empty || saving || !canSave} onClick={save}>
          {submitLabel}
        </InputGroupButton>
      </InputGroupAddon>
      {error !== null && (
        <InputGroupAddon align="block-end">
          <FieldError>{error}</FieldError>
        </InputGroupAddon>
      )}
    </InputGroup>
  );

  return embedded ? <div className="border-t p-2">{group}</div> : group;
}

export function useCommentBox(view: RefObject<HTMLDivElement | null> | undefined) {
  const element = useRef<HTMLDivElement>(null);
  const width = useCommentWidth(element, view);
  return { element, style: width === undefined ? undefined : { width } };
}
