import { type KeyboardEvent, useRef } from "react";

/** Safari may deliver the confirming Enter just after compositionend. Never treat it as an application shortcut. */
export function useCompositionGuard() {
  const composing = useRef(false);
  const until = useRef(0);
  const active = (): boolean => composing.current || Date.now() < until.current;
  return {
    active,
    owns(event: KeyboardEvent): boolean {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
        until.current = Date.now() + 10;
        return true;
      }
      return active();
    },
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: () => {
      composing.current = false;
      until.current = Date.now() + 10;
    },
  };
}
