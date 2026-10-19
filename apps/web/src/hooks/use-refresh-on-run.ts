import { useEffect, useEffectEvent, useRef } from "react";

/**
 * Keeps what the server reads on demand current for what a page shows. `refresh` is called when `key` is first shown
 * and whenever it changes, and when `active` falls from true to false, which is when a run of the agent ends: the
 * extensions in pi's own UI refresh on session start and `agent_end`. A failed read leaves what was shown, to be
 * tried again by the next one.
 */
export function useRefreshOnRun<Key>(
  key: Key | undefined,
  active: boolean | undefined,
  refresh: (key: Key, why: "shown" | "ended") => Promise<unknown>,
): void {
  const read = useEffectEvent((shown: Key, why: "shown" | "ended") => {
    refresh(shown, why).catch(() => {});
  });

  useEffect(() => {
    if (key !== undefined) read(key, "shown");
  }, [key]);

  const running = useRef(active === true);
  useEffect(() => {
    const ended = running.current && active !== true;
    running.current = active === true;
    if (ended && key !== undefined) read(key, "ended");
  }, [key, active]);
}
