import { createElement, type ReactNode } from "react";
import { MessageListProvider } from "../src/components/agent/message-list.tsx";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerViewport,
} from "../src/components/ui/message-scroller.tsx";

/**
 * A turn is a row of the scroller, so a test that draws one needs a transcript around it. It is the parts of a
 * `MessageList` without its jump to latest button, so a test that looks for "the button" of a step finds only that.
 */
export function inTranscript(turn: ReactNode) {
  return createElement(
    MessageListProvider,
    null,
    createElement(
      MessageScroller,
      null,
      createElement(MessageScrollerViewport, null, createElement(MessageScrollerContent, null, turn)),
    ),
  );
}
