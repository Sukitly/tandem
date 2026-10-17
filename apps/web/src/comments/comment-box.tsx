import type { CommentMessage, CommentThread } from "@tandem/contracts";
import { type RefObject, useRef, useState, useSyncExternalStore } from "react";
import { useDrafts, useTextDraft } from "@/app/drafts.tsx";
import { useWorkbench } from "@/app/workbench.tsx";
import { Markdown } from "@/chat/markdown.tsx";
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
import { FieldError } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useCompositionGuard } from "@/hooks/use-composition-guard.ts";
import { commentPlace } from "./comment-anchor.ts";
import type { ProjectComments } from "./project-comments.ts";
import { useCommentWidth } from "./use-comment-width.ts";

/**
 * The surface a comment sits in, written or being written. The writing one is an input group, so both take its
 * surface; the border between the note and its buttons is ours.
 */
const SURFACE = "m-2 rounded-lg border border-input font-sans dark:bg-input/30";

/** The box a comment is written in: a new thread, a reply, or an edit of a message that is still waiting. */
export function CommentDraft({
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
  /** Stable identity across closing panels, disconnects, and switching layouts. */
  draftKey?: string;
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
  const drafts = useDrafts();
  const draft = useTextDraft(draftKey, initial);
  const { text, sending: saving, error } = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  const composition = useCompositionGuard();
  const box = useCommentBox(embedded ? undefined : view);
  const empty = text.trim() === "";
  // A refused note stays in the box with the reason under it, so it can be changed and saved again.
  const save = (): void => {
    if (empty || saving) return;
    void draft
      .send(() => onSave(text.trim()))
      .then((saved) => {
        if (saved && draftKey !== undefined && draft.getSnapshot().text === "") drafts?.forgetText(draftKey, draft);
      });
  };
  const cancel = (): void => {
    if (saving) return;
    if (draftKey !== undefined && drafts !== null) drafts.forgetText(draftKey, draft);
    else draft.reset();
    onCancel();
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
          // Enter writes another line; the note is saved with the modifier, as a message box would send.
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
        <InputGroupButton size="xs" variant="default" disabled={empty || saving} onClick={save}>
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
  detached,
}: {
  thread: CommentThread;
  comments: ProjectComments;
  /** The scrollable view the box sits in, whose right edge is where the box has to end. */
  view?: RefObject<HTMLDivElement | null>;
  /** Layout only, such as where in the view the box begins. */
  className?: string;
  /**
   * The box is not on a line, and shows the code it was written on: its line is not in the file any more (`outdated`),
   * or it is on a line the changes removed, shown with the file as it is (`removed`).
   */
  detached?: "outdated" | "removed" | "outside" | "unverified";
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [replying, setReplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { reportFailure } = useWorkbench();
  const box = useCommentBox(view);
  return (
    <div ref={box.element} className={`${SURFACE} ${className ?? ""} flex flex-col text-sm`} style={box.style}>
      {detached !== undefined && <WrittenOnCode thread={thread} why={detached} />}
      {thread.messages.map((message) =>
        editing === message.id ? (
          <CommentDraft
            key={message.id}
            draftKey={`comment-edit:${thread.workspaceId}:${thread.id}:${message.id}`}
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
            onWithdraw={() =>
              comments
                .withdraw(thread.id, message.id)
                .catch((error: unknown) => reportFailure("Could not take back the comment", error))
            }
          />
        ),
      )}
      {replying ? (
        <CommentDraft
          draftKey={`comment-reply:${thread.workspaceId}:${thread.id}`}
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
                comments
                  .remove(thread.id)
                  .catch((error: unknown) => reportFailure("Could not delete the thread", error));
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
      {/* The agent writes Markdown, and may repeat what a file told it: it renders as a message of the transcript does. */}
      {message.author === "agent" ? (
        <Markdown text={message.text} />
      ) : (
        <p className="break-words whitespace-pre-wrap">{message.text}</p>
      )}
    </div>
  );
}

/** The code a thread was written on, for a thread whose line is gone: the line marked, with the lines kept around it. */
function WrittenOnCode({
  thread,
  why,
}: {
  thread: CommentThread;
  why: "outdated" | "removed" | "outside" | "unverified";
}) {
  const { anchor } = thread;
  const first = anchor.line - anchor.before.length;
  const lines = [...anchor.before, anchor.quote, ...anchor.after];
  return (
    <div className="flex flex-col gap-1 border-b px-2.5 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">
          {why === "unverified"
            ? "Location not verified"
            : why === "outdated"
              ? "Outdated"
              : why === "outside"
                ? "Outside this diff"
                : "On a removed line"}
        </Badge>
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
  return { element, style: width === undefined ? undefined : { width } };
}
