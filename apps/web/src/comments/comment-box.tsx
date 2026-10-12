import { useEffect, useRef, useState } from "react";
import { plainCommentRow } from "@/changes/diff-plain-annotations.ts";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { commentPlace, type LineComment } from "./line-comment.ts";

/**
 * The surface a comment sits in, written or being written. The writing one is an input group, so both take its
 * surface; the border between the note and its buttons is ours.
 */
const SURFACE = "m-2 rounded-lg border border-input font-sans dark:bg-input/30";

/** The box a comment is written in, under the line it is about. */
export function CommentDraft({
  place,
  initial = "",
  onSave,
  onCancel,
}: {
  /** The file and line it is about, named above the box as a code host names it. */
  place?: string;
  initial?: string;
  onSave(text: string): void;
  onCancel(): void;
}) {
  const [text, setText] = useState(initial);
  const box = usePlainRow();
  const empty = text.trim() === "";
  return (
    <InputGroup ref={box} className={SURFACE}>
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
        className="min-h-20"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          // Enter writes another line; the note is sent with the modifier, as a message box would.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !empty) onSave(text.trim());
        }}
      />
      <InputGroupAddon align="block-end" className="justify-end border-t">
        <InputGroupButton size="xs" variant="outline" onClick={onCancel}>
          Cancel
        </InputGroupButton>
        <InputGroupButton size="xs" variant="default" disabled={empty} onClick={() => onSave(text.trim())}>
          Comment
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** A comment that has been written, editable in the place it is about. */
export function CommentNote({
  comment,
  onSave,
  onRemove,
}: {
  comment: LineComment;
  onSave(text: string): void;
  onRemove(): void;
}) {
  const [editing, setEditing] = useState(false);
  const box = usePlainRow();
  if (editing) {
    return (
      <CommentDraft
        place={commentPlace(comment)}
        initial={comment.text}
        onSave={(text) => {
          onSave(text);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <div ref={box} className={`${SURFACE} flex flex-col text-sm`}>
      <p className="px-2.5 py-2 break-words whitespace-pre-wrap">{comment.text}</p>
      <div className="flex items-center justify-end gap-2 border-t px-2.5 py-2">
        <Button type="button" size="xs" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button type="button" size="xs" variant="destructive" onClick={onRemove}>
          Delete
        </Button>
      </div>
    </div>
  );
}

/** A comment's row in a diff carries the library's own background; this takes it away while a comment is shown there. */
function usePlainRow() {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    plainCommentRow(element.current);
  }, []);
  return element;
}
