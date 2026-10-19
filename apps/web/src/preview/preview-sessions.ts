import { useCallback, useEffect, useState } from "react";

/** The ports that have a frame, each with how many times its frame was reloaded. */
export type PreviewSessions = ReadonlyMap<number, number>;

/**
 * Only a port that was visited has a frame, and keeps it, hidden, while another is shown: its document and its forms
 * are not lost by switching tabs. A port that is gone loses its frame. What is the same is returned as it was.
 */
function syncSessions(
  previous: PreviewSessions,
  ports: readonly number[],
  current: number | null,
  active: boolean,
): PreviewSessions {
  const next = new Map([...previous].filter(([port]) => ports.includes(port)));
  if (active && current !== null && !next.has(current)) next.set(current, 0);
  const same = next.size === previous.size && [...next].every(([port, revision]) => previous.get(port) === revision);
  return same ? previous : next;
}

/** A port's frame, drawn again from the start. */
function reloaded(previous: PreviewSessions, port: number): PreviewSessions {
  return new Map(previous).set(port, (previous.get(port) ?? 0) + 1);
}

export function usePreviewSessions(ports: readonly number[], current: number | null, active: boolean) {
  const [sessions, setSessions] = useState<PreviewSessions>(() => syncSessions(new Map(), ports, current, active));
  useEffect(() => {
    setSessions((previous) => syncSessions(previous, ports, current, active));
  }, [ports, current, active]);
  const reload = useCallback((port: number) => setSessions((previous) => reloaded(previous, port)), []);
  return { sessions, reload };
}
