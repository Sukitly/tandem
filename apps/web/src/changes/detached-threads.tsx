import { usePanelNavigation } from "@/app/workbench.tsx";
import { CommentThreadBox } from "@/comments/comment-box.tsx";
import type { ProjectComments } from "@/comments/project-comments.ts";
import { Button } from "@/components/ui/button.tsx";
import type { DetachedThread } from "./use-detached-threads.ts";

/**
 * The comments of a file that its patch does not show, above the patch: they stay visible while their places are
 * checked against the file, and each can be opened in the file at the place it has moved to.
 */
export function DetachedThreads({
  path,
  comments,
  threads,
  verifying,
  failure,
  onRetry,
}: {
  path: string;
  comments: ProjectComments;
  threads: readonly DetachedThread[];
  verifying: boolean;
  failure: string | null;
  onRetry(): void;
}) {
  const { openFile } = usePanelNavigation();
  if (threads.length === 0) return null;
  return (
    <div className="max-h-1/2 shrink-0 overflow-auto border-b">
      {verifying && (
        <p role="status" className="p-2 text-xs">
          Checking comment locations…
        </p>
      )}
      {failure !== null && (
        <div role="alert" className="p-2 text-sm">
          <p>Could not verify comment locations: {failure}</p>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry location check
          </Button>
        </div>
      )}
      {threads.map(({ thread, line, reason }) => (
        <div key={thread.id} data-detached-thread={thread.id}>
          <CommentThreadBox thread={thread} comments={comments} detached={reason} />
          {reason !== "outdated" && thread.anchor.side !== "deletions" && (
            <Button
              variant="link"
              size="sm"
              onClick={() => openFile(path, { threadId: thread.id, line: line ?? thread.anchor.line })}
            >
              Show comment in file
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
