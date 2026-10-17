import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useCommentDraftStore } from "@/app/drafts.tsx";
import { anchorAt, indexLines } from "./comment-anchor.ts";
import { type AnchoredDraft, type CommentSide, type DraftLines, locateDraft } from "./comment-drafts.ts";

export interface PlacedDraft {
  record: AnchoredDraft;
  side: CommentSide;
  line: number | undefined;
}
export function useCommentDrafts(workspaceId: number, path: string, kind: "file" | "diff", snapshot: DraftLines) {
  const store = useCommentDraftStore();
  const records = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const placed = useMemo(() => {
    const indexes: Partial<Record<CommentSide, Map<string, number[]>>> = {};
    return records
      .filter((record) => record.workspaceId === workspaceId && record.anchor.path === path)
      .map((record) => {
        const side = record.anchor.side ?? "additions";
        const lines = snapshot[side];
        let line = locateDraft(record, snapshot, []);
        if (line === undefined && lines !== undefined) {
          indexes[side] ??= indexLines((at) => lines.get(at), lines.keys());
          const index = indexes[side];
          line = locateDraft(record, snapshot, index.get(record.anchor.quote) ?? []);
        }
        return { record, side, line };
      });
  }, [records, workspaceId, path, snapshot]);
  const byLine = useMemo(() => {
    const result = new Map<string, PlacedDraft[]>();
    for (const draft of placed) {
      if (draft.line === undefined) continue;
      const key = `${draft.side}:${draft.line}`;
      const group = result.get(key);
      if (group === undefined) result.set(key, [draft]);
      else group.push(draft);
    }
    return result;
  }, [placed]);
  const detached = useMemo(() => placed.filter((entry) => entry.line === undefined), [placed]);
  const start = useCallback(
    (side: CommentSide, line: number): void => {
      if (snapshot[side]?.get(line) === undefined || placed.some((entry) => entry.side === side && entry.line === line))
        return;
      store.create(
        workspaceId,
        anchorAt({ path, side, line }, (number) => snapshot[side]?.get(number)),
        { kind, snapshot },
      );
    },
    [snapshot, placed, store, workspaceId, path, kind],
  );
  return { store, placed, detached, byLine, start };
}
