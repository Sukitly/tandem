import { useEffect, useRef, useState } from "react";

/** How often text that is still arriving is drawn again. Drawing Markdown costs about 2ms for each 1,000 characters. */
export const DRAW_INTERVAL_MS = 100;

/**
 * `text` as it should be drawn. While it is `streaming` it is drawn at most once an interval, with whatever has arrived
 * by then, so a long reply that grows by a few characters at a time does not draw all of itself again for each of them.
 * Once it is not streaming it is drawn at once and whole, so nothing that arrived is held back.
 *
 * It is a throttle, not a debounce: text that keeps arriving is still drawn once each interval, not after it stops.
 */
export function useThrottledText(text: string, streaming: boolean, interval = DRAW_INTERVAL_MS): string {
  const [drawn, setDrawn] = useState(text);
  const latest = useRef(text);
  latest.current = text;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Not streaming: what is drawn is the text, so a later stream starts from it and not from an older one.
  if (!streaming && drawn !== text) setDrawn(text);

  useEffect(() => {
    if (!streaming || drawn === text || timer.current !== undefined) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setDrawn(latest.current);
    }, interval);
  }, [streaming, drawn, text, interval]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return streaming ? drawn : text;
}
