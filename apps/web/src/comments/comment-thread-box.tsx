import type { CommentThread } from "@tandem/contracts";
import { type RefObject, useState } from "react";
import { useWorkbench } from "@/app/workbench.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { commentPlace } from "./comment-anchor.ts";
import { COMMENT_SURFACE, CommentDraft, useCommentBox } from "./comment-draft.tsx";
import type { ProjectComments } from "./project-comments.ts";
import { ThreadMessage, WrittenOnCode } from "./thread-message.tsx";

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
  view?: RefObject<HTMLDivElement | null>;
  className?: string;
  detached?: "outdated" | "removed" | "outside" | "unverified";
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [replying, setReplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { reportFailure } = useWorkbench((state) => ({ reportFailure: state.reportFailure }));
  const box = useCommentBox(view);

  return (
    <div ref={box.element} className={`${COMMENT_SURFACE} ${className ?? ""} flex flex-col text-sm`} style={box.style}>
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
