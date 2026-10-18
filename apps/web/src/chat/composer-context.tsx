import { type ReactNode, useState } from "react";
import { CommentList } from "@/comments/comment-list.tsx";
import type { WaitingComment } from "@/comments/project-comments.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible.tsx";
import { Item, ItemContent, ItemDescription, ItemGroup } from "@/components/ui/item.tsx";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { cn } from "@/lib/utils.ts";
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
    <ComposerDetails label={`${queued.length} queued messages · ${comments.length} review comments`}>
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
    </ComposerDetails>
  );
}

/** Small screens start with ancillary context collapsed, leaving room to read and type. */
export function ComposerDetails({ label, children }: { label: string; children: ReactNode }) {
  const mobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  return (
    <Collapsible open={!mobile || expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            className={cn("min-h-11 w-full justify-start text-xs text-muted-foreground", !mobile && "hidden")}
          />
        }
      >
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted>{children}</CollapsibleContent>
    </Collapsible>
  );
}
