import type { ChangedFile, ChangesState } from "@tandem/contracts";
import { useCallback, useEffect, useState } from "react";
import type { DiffReadingState } from "./change-diff.tsx";
import type { ChangeTarget } from "./change-target.ts";

/**
 * Which file the list shows is chosen once, as the first the list holds, and then kept for as long as the file is in
 * the list. A file that leaves it leaves the selection too.
 */
export function selectionAfter(
  files: readonly Pick<ChangedFile, "path">[],
  selected: string | null,
  initialized: boolean,
): { selected: string | null; initialized: boolean } {
  if (!initialized && files.length > 0) return { selected: files[0]?.path ?? null, initialized: true };
  return { selected: files.some((file) => file.path === selected) ? selected : null, initialized };
}

/**
 * The selected file of a project's changes, and what is kept of reading it. A place asked for, such as the line a
 * comment is on, selects its file once the list holds it; until it does, or if it never does, the place is opened in
 * the file itself.
 */
export function useChangeSelection(
  state: ChangesState | undefined,
  reveal: ChangeTarget | undefined,
  {
    openFile,
    settle,
  }: {
    openFile(path: string, place: { line?: number; threadId?: number }): void;
    /** The place asked for has been dealt with. */
    settle(): void;
  },
) {
  const [choice, setChoice] = useState({
    selected: state?.files[0]?.path ?? null,
    initialized: state?.files[0] !== undefined,
  });
  const [reading] = useState<DiffReadingState>(() => ({ positions: new Map(), revealed: new WeakSet() }));
  const [revealed, setRevealed] = useState<ChangeTarget | null>(null);
  const select = useCallback((path: string | null) => setChoice((previous) => ({ ...previous, selected: path })), []);

  useEffect(() => {
    if (reveal === undefined || state === undefined) return;
    if (state.status === "ready" && state.files.some((file) => file.path === reveal.path)) {
      setChoice({ selected: reveal.path, initialized: true });
      setRevealed(reveal);
    } else {
      openFile(reveal.path, {
        ...(reveal.line === undefined ? {} : { line: reveal.line }),
        ...(reveal.threadId === undefined ? {} : { threadId: reveal.threadId }),
      });
    }
    settle();
  }, [reveal, state, openFile, settle]);

  useEffect(() => {
    if (state?.status !== "ready") return;
    for (const path of reading.positions.keys()) {
      if (!state.files.some((file) => file.path === path)) reading.positions.delete(path);
    }
    setChoice((previous) => {
      const next = selectionAfter(state.files, previous.selected, previous.initialized);
      return next.selected === previous.selected && next.initialized === previous.initialized ? previous : next;
    });
  }, [state, reading]);

  return { selected: choice.selected, select, revealed, reading };
}
