import { XIcon } from "lucide-react";
import { useWorkbench } from "@/app/workbench.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup } from "@/components/ui/item";
import { commentPlace } from "./comment-anchor.ts";
import type { WaitingComment } from "./project-comments.ts";

/** The comments waiting to be sent, above the message box: what the next message will carry. */
export function CommentList({
  comments,
  onWithdraw,
}: {
  comments: WaitingComment[];
  onWithdraw(comment: WaitingComment): void;
}) {
  const { openChange } = useWorkbench();
  if (comments.length === 0) return null;
  return (
    <ItemGroup aria-label="Comments to send" className="gap-1">
      {comments.map((comment) => {
        const { anchor } = comment.thread;
        const place = commentPlace(anchor);
        return (
          <Item key={comment.messageId} size="xs" variant="muted">
            <Badge variant="outline">{comment.thread.messages[0]?.id === comment.messageId ? "Review" : "Reply"}</Badge>
            <ItemContent>
              <ItemDescription className="truncate">{comment.text}</ItemDescription>
            </ItemContent>
            <Button
              type="button"
              variant="link"
              size="xs"
              className="shrink-0"
              title={`Show ${place} in the changes`}
              onClick={() =>
                openChange({ path: anchor.path, line: anchor.line, side: anchor.side, threadId: comment.thread.id })
              }
            >
              <span className="font-mono">{place}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Take back the comment on ${place}`}
              onClick={() => onWithdraw(comment)}
            >
              <XIcon />
            </Button>
          </Item>
        );
      })}
    </ItemGroup>
  );
}
