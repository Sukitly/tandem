import type { CommentMessage, CommentThread } from "@tandem/contracts";
import { type RefObject, useEffect, useRef, useState } from "react";
import { plainCommentRow } from "@/changes/diff-plain-annotations.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { commentPlace } from "./comment-anchor.ts";
import { type ProjectComments, reportFailure } from "./project-comments.ts";
import { useCommentWidth } from "./use-comment-width.ts";

/**
 * The surface a comment sits in, written or being written. The writing one is an input group, so both take its
 * surface; the border between the note and its buttons is ours.
 */
const SURFACE = "m-2 rounded-lg border border-input font-sans dark:bg-input/30";

/** The box a comment is written in: a new thread, a reply, or an edit of a message that is still waiting. */
export function CommentDraft({
  place,
  view,
  className,
  initial = "",
  submitLabel = "Comment",
  embedded = false,
  onSave,
  onCancel,
}: {
  /** The file and line it is about, named above the box as a code host names it. */
  place?: string;
  /** The scrollable view the box sits in, whose right edge is where the box has to end. */
  view?: RefObject<HTMLDivElement | null>;
  /** Layout only, such as where in the view the box begins. */
  className?: string;
  initial?: string;
  submitLabel?: string;
  /** Inside a thread's box, which has the surface and the width already. */
  embedded?: boolean;
  /** Rejects when the server refuses it; the box then keeps the text. */
  onSave(text: string): Promise<unknown>;
  onCancel(): void;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const box = useCommentBox(embedded ? undefined : view);
  const empty = text.trim() === "";
  const save = (): void => {
    if (empty || saving) return;
    setSaving(true);
    onSave(text.trim()).then(
      () => setSaving(false),
      (error: unknown) => {
        setSaving(false);
        reportFailure(error);
      },
    );
  };
  const group = (
    <InputGroup ref={box.element} className={embedded ? undefined : `${SURFACE} ${className ?? ""}`} style={box.style}>
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
          // Enter writes another line; the note is saved with the modifier, as a message box would send.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save();
        }}
      />
      <InputGroupAddon align="block-end" className="justify-end border-t">
        <InputGroupButton size="xs" variant="outline" onClick={onCancel}>
          Cancel
        </InputGroupButton>
        <InputGroupButton size="xs" variant="default" disabled={empty || saving} onClick={save}>
          {submitLabel}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
  // In a thread's box the group is the stock one, set off from the messages above it.
  return embedded ? <div className="border-t p-2">{group}</div> : group;
}

/**
 * A thread on its line: the discussion so far, oldest first. A message the user wrote can be changed or taken back
 * until it is sent; after that it is part of what the agent read.
 */
export function CommentThreadBox({
  thread,
  comments,
  view,
  className,
  outdated = false,
}: {
  thread: CommentThread;
  comments: ProjectComments;
  /** The scrollable view the box sits in, whose right edge is where the box has to end. */
  view?: RefObject<HTMLDivElement | null>;
  /** Layout only, such as where in the view the box begins. */
  className?: string;
  /** The line is not in the file any more: the box shows the code it was written on. */
  outdated?: boolean;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [replying, setReplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const box = useCommentBox(view);
  return (
    <div ref={box.element} className={`${SURFACE} ${className ?? ""} flex flex-col text-sm`} style={box.style}>
      {outdated && <OutdatedCode thread={thread} />}
      {thread.messages.map((message) =>
        editing === message.id ? (
          <CommentDraft
            key={message.id}
            initial={message.text}
            submitLabel="Save"
            embedded
            onSave={async (text) => {
              await comments.edit(thread.id, message.id, text);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <ThreadMessage
            key={message.id}
            message={message}
            onEdit={() => setEditing(message.id)}
            onWithdraw={() => comments.withdraw(thread.id, message.id).catch(reportFailure)}
          />
        ),
      )}
      {replying ? (
        <CommentDraft
          submitLabel="Reply"
          embedded
          onSave={async (text) => {
            await comments.reply(thread.id, text);
            setReplying(false);
          }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <div className="flex items-center justify-end gap-2 border-t px-2.5 py-2">
          <Button type="button" size="xs" variant="outline" onClick={() => setReplying(true)}>
            Reply
          </Button>
          <Button type="button" size="xs" variant="destructive" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        </div>
      )}
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this thread?</AlertDialogTitle>
            <AlertDialogDescription>
              The thread on {commentPlace(thread.anchor)} and its messages are deleted. What was sent stays in the
              conversations it was sent to.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setDeleting(false);
                comments.remove(thread.id).catch(reportFailure);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** One message of a thread, with who wrote it and, for a user's message, whether it went to the agent. */
function ThreadMessage({
  message,
  onEdit,
  onWithdraw,
}: {
  message: CommentMessage;
  onEdit(): void;
  onWithdraw(): void;
}) {
  const waiting = message.author === "user" && message.sent === undefined;
  return (
    <div className="flex flex-col gap-1 border-b px-2.5 py-2 last:border-b-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{message.author === "user" ? "You" : "Agent"}</span>
        {waiting && <Badge variant="outline">Not sent</Badge>}
        {waiting && (
          <span className="ml-auto flex gap-1">
            <Button type="button" size="xs" variant="ghost" onClick={onEdit}>
              Edit
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={onWithdraw}>
              Take back
            </Button>
          </span>
        )}
      </div>
      <p className="break-words whitespace-pre-wrap">{message.text}</p>
    </div>
  );
}

/** The code a thread was written on, for a thread whose line is gone: the line marked, with the lines kept around it. */
function OutdatedCode({ thread }: { thread: CommentThread }) {
  const { anchor } = thread;
  const first = anchor.line - anchor.before.length;
  const lines = [...anchor.before, anchor.quote, ...anchor.after];
  return (
    <div className="flex flex-col gap-1 border-b px-2.5 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">Outdated</Badge>
        <span className="font-mono">{commentPlace(anchor)}</span>
      </div>
      <pre className="overflow-x-auto font-mono text-xs leading-relaxed">
        {lines.map((line, index) => {
          const number = first + index;
          return (
            <div key={number} className={number === anchor.line ? "bg-muted" : "text-muted-foreground"}>
              <span className="inline-block w-10 pr-2 text-right select-none">{number}</span>
              {line}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

/**
 * The box's own element, with what it needs of its surroundings: a comment's row in a diff carries the library's
 * background, which is taken away while a comment is shown there, and the box ends at the view's right edge rather
 * than at the longest line's.
 */
function useCommentBox(view: RefObject<HTMLDivElement | null> | undefined) {
  const element = useRef<HTMLDivElement>(null);
  const width = useCommentWidth(element, view);
  useEffect(() => {
    plainCommentRow(element.current);
  }, []);
  return { element, style: width === undefined ? undefined : { width } };
}
