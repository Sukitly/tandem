import { XIcon } from "lucide-react";
import { useWorkbench } from "@/app/workbench.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup } from "@/components/ui/item";
import { commentPlace, type LineComment } from "./line-comment.ts";

/** The comments waiting to be sent, above the message box: what the next message will carry. */
export function CommentList({ comments, onRemove }: { comments: LineComment[]; onRemove(id: string): void }) {
  const { openChange } = useWorkbench();
  if (comments.length === 0) return null;
  return (
    <ItemGroup aria-label="Comments to send" className="gap-1">
      {comments.map((comment) => (
        <Item key={comment.id} size="xs" variant="muted">
          <Badge variant="outline">Review</Badge>
          <ItemContent>
            <ItemDescription className="truncate">{comment.text.trim()}</ItemDescription>
          </ItemContent>
          <button
            type="button"
            className="shrink-0 cursor-pointer font-mono text-xs text-primary underline"
            title={`Show ${commentPlace(comment)} in the changes`}
            onClick={() => openChange({ path: comment.path, line: comment.line, side: comment.side })}
          >
            {commentPlace(comment)}
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove the comment on ${commentPlace(comment)}`}
            onClick={() => onRemove(comment.id)}
          >
            <XIcon />
          </Button>
        </Item>
      ))}
    </ItemGroup>
  );
}
