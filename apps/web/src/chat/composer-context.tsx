import { CommentList } from "@/comments/comment-list.tsx";
import type { WaitingComment } from "@/comments/project-comments.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Item, ItemContent, ItemDescription, ItemGroup } from "@/components/ui/item.tsx";
import type { QueuedMessage } from "./transcript.ts";

export function ComposerContext({
  comments,
  queued,
  onWithdrawComment,
}: {
  comments: WaitingComment[];
  queued: QueuedMessage[];
  onWithdrawComment?(comment: WaitingComment): void;
}) {
  if (comments.length === 0 && queued.length === 0) return null;
  return (
    <section
      className="grid max-h-[15dvh] gap-2 overflow-y-auto overscroll-contain"
      aria-label="Pending message context"
    >
      <CommentList comments={comments} onWithdraw={(comment) => onWithdrawComment?.(comment)} />
      {queued.length > 0 && (
        <ItemGroup aria-label="Queued messages" className="gap-1">
          {queued.map((message) => (
            <Item key={message.id} size="xs" variant="muted">
              <Badge variant="outline">{message.mode === "steer" ? "Steering" : "Follow-up"}</Badge>
              <ItemContent className="min-w-0">
                <ItemDescription className="line-clamp-none whitespace-pre-wrap wrap-anywhere">
                  {message.text}
                </ItemDescription>
              </ItemContent>
              {message.imageCount > 0 && (
                <Badge variant="secondary">
                  {message.imageCount === 1 ? "1 image" : `${message.imageCount} images`}
                </Badge>
              )}
            </Item>
          ))}
        </ItemGroup>
      )}
    </section>
  );
}
