import { useEffect, useRef, useState } from "react";
import { plainCommentRow } from "@/changes/diff-plain-annotations.ts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { commentPlace, type LineComment } from "./line-comment.ts";

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
    <div ref={box} className="m-2 flex flex-col overflow-hidden rounded-md border bg-card font-sans text-sm">
      {place !== undefined && (
        <p className="border-b bg-muted/50 px-3 py-1.5 font-mono text-xs text-muted-foreground">{place}</p>
      )}
      <Textarea
        autoFocus
        rows={3}
        value={text}
        aria-label="Comment"
        placeholder="What should change here?"
        className="min-h-20 rounded-none border-0 bg-transparent px-3 py-2 focus-visible:ring-0 dark:bg-transparent"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          // Enter writes another line; the note is sent with the modifier, as a message box would.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !empty) onSave(text.trim());
        }}
      />
      <div className="flex items-center justify-end gap-2 border-t px-2 py-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={empty} onClick={() => onSave(text.trim())}>
          Comment
        </Button>
      </div>
    </div>
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
    <div ref={box} className="m-2 flex flex-col overflow-hidden rounded-md border bg-card font-sans text-sm">
      <p className="px-3 py-2 break-words whitespace-pre-wrap">{comment.text}</p>
      <div className="flex items-center justify-end gap-2 border-t px-2 py-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button type="button" size="sm" variant="destructive" onClick={onRemove}>
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
