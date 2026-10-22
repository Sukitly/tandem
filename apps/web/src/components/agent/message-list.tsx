import { cn } from "cn";
import type { ComponentProps, ReactNode } from "react";

import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";

type MessageListProviderProps = ComponentProps<typeof MessageScrollerProvider>;

/**
 * Holds the scroll state of a transcript. Put it around the `MessageList` and
 * whatever has to move it, such as the prompt input, so that
 * `useMessageListScroller` reaches the list from there. Its props set how the
 * list follows new content: `autoScroll` keeps it at the live edge while the
 * reader stays there, `defaultScrollPosition` is where it starts (`start`,
 * `end` or `last-anchor`), and `scrollMargin` is the space kept above a turn
 * that is scrolled to.
 */
function MessageListProvider(props: MessageListProviderProps) {
  return <MessageScrollerProvider {...props} />;
}

/**
 * Moves the transcript from outside it: `scrollToEnd`, `scrollToStart` and
 * `scrollToMessage`, which takes the `id` of a `MessageListItem` and
 * `align: "center"` to put it in the middle. A turn that is not mounted yet is
 * waited for. Each returns whether it scrolled. Only inside a
 * `MessageListProvider`.
 */
function useMessageListScroller() {
  return useMessageScroller();
}

type MessageListProps = {
  children: ReactNode;
  /** Names the transcript for screen readers. Defaults to "Messages". */
  label?: string;
  /** Names the jump to latest button for screen readers. */
  scrollToEndLabel?: string;
  /** Applied to the scroll frame, which fills whatever parent has a height. */
  className?: string;
  /**
   * Applied to the viewport, the element that scrolls inside the frame, for a
   * class of your own that needs it, such as a scrollbar that follows its
   * `data-scrollable` and `data-autoscrolling` attributes.
   */
  viewportClassName?: string;
  /** Applied to the column that holds the turns. */
  contentClassName?: string;
};

/**
 * The transcript of a conversation. Built on the shadcn/ui message scroller, so
 * a reply streams in without moving a reader who scrolled away, and a jump to
 * latest button appears once there is somewhere to jump back to.
 *
 * The list fills its parent, so give it a parent that has a height, and put
 * it inside a `MessageListProvider`.
 */
function MessageList({
  label,
  scrollToEndLabel,
  className,
  viewportClassName,
  contentClassName,
  children,
}: MessageListProps) {
  return (
    <MessageScroller className={className}>
      <MessageScrollerViewport aria-label={label} className={viewportClassName}>
        <MessageScrollerContent
          // The padding above and below is what keeps the first and last turns off
          // the edges, and the scroller counts it when it settles a turn near the
          // top, so a question that is pinned keeps the same space above it.
          className={cn("max-w-3xl px-4 py-6 mx-auto w-full", contentClassName)}
        >
          {children}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton aria-label={scrollToEndLabel} className="motion-reduce:transition-none" />
    </MessageScroller>
  );
}

type MessageListItemProps = {
  children: ReactNode;
  /** Identifies the turn, so the scroller can anchor and scroll to it. */
  id: string;
  /** Which side of the transcript the turn sits on. A reply starts. */
  align?: "start" | "end";
  /** Make this the turn the transcript settles on. Normally the person's. */
  anchor?: boolean;
  className?: string;
};

/**
 * One turn in the transcript: a scroller row, a message, and the column its
 * content sits in. Everything inside is the turn's own content.
 */
function MessageListItem({ id, align = "start", anchor = false, className, children }: MessageListItemProps) {
  return (
    <MessageScrollerItem messageId={id} scrollAnchor={anchor} className={className}>
      <Message align={align}>
        <MessageContent>{children}</MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}

export { MessageList, MessageListItem, MessageListProvider, useMessageListScroller };
