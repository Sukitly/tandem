import { cn } from "cn";
import type { ReactNode } from "react";

import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

type ConversationEmptyProps = {
  /** Shown in a small tile above the title. */
  icon?: ReactNode;
  /** The greeting, such as a question about what to work on. */
  title: ReactNode;
  /** Added to the title, for a size of your own. */
  titleClassName?: string;
  /** A line under the title, in grey. */
  description?: ReactNode;
  /**
   * Anything under the description. Put the prompt input here to have it in the
   * middle of the page with the greeting, as on a new conversation's home page,
   * rather than at the bottom.
   */
  children?: ReactNode;
  className?: string;
};

/**
 * What a conversation shows before its first message: a greeting, centred in
 * the space that the transcript will fill. Built on the shadcn/ui empty, with
 * the title a size up since it is the one thing on the page.
 *
 * It fills its parent, so render it in place of `MessageList` and the input
 * stays where it is. Once there is a message, render the list instead.
 */
function ConversationEmpty({ icon, title, titleClassName, description, children, className }: ConversationEmptyProps) {
  return (
    <Empty className={cn("h-full min-h-0", className)}>
      <EmptyHeader>
        {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle className={cn("text-lg", titleClassName)}>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children && (
        // The input is as wide as the transcript's column, not the empty's
        // narrow one.
        <EmptyContent className="max-w-3xl">{children}</EmptyContent>
      )}
    </Empty>
  );
}

export { ConversationEmpty };
