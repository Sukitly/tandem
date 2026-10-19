import type { RefObject } from "react";
import { CommentDraft } from "./comment-box.tsx";
import type { CommentDrafts, DraftLines } from "./comment-drafts.ts";
import type { ProjectComments } from "./project-comments.ts";
import { type PlacedDraft, useCommentDrafts } from "./use-comment-drafts.ts";

const UNAVAILABLE: DraftLines = {};

/** Missing or non-text file content does not discard an unsent note. */
export function UnverifiedCommentDrafts({ path, comments }: { path: string; comments: ProjectComments }) {
  const drafts = useCommentDrafts(comments.workspaceId, path, "file", UNAVAILABLE);
  return (
    <div className="max-h-1/2 overflow-auto">
      {drafts.detached.map((draft) => (
        <AnchoredCommentEditor key={draft.record.id} draft={draft} store={drafts.store} comments={comments} />
      ))}
    </div>
  );
}

/** Unverified drafts remain editable, but cannot be submitted against an unproven location. */
export function AnchoredCommentEditor({
  draft,
  store,
  comments,
  view,
  embedded = false,
  className,
}: {
  draft: PlacedDraft;
  store: CommentDrafts;
  comments: ProjectComments;
  view?: RefObject<HTMLDivElement | null>;
  embedded?: boolean;
  className?: string;
}) {
  const { record, line } = draft;
  return (
    <div className={className} data-comment-draft={record.id}>
      {line === undefined && (
        <p className="px-2 pt-2 text-xs text-muted-foreground">
          Location not verified. Copy this draft to a new line or cancel it.
        </p>
      )}
      <CommentDraft
        model={record.text}
        canSave={line !== undefined}
        place={`${record.anchor.path}:${line ?? record.anchor.line}${draft.side === "deletions" ? " (removed)" : ""}`}
        view={view}
        embedded={embedded}
        onCancel={() => store.forget(record)}
        onSave={async (note) => {
          if (line === undefined) throw new Error("The comment location has not been verified.");
          const anchor = { ...record.anchor, line };
          if (anchor.side === "additions") delete anchor.side;
          await comments.start(anchor, note);
          store.forget(record);
        }}
      />
    </div>
  );
}
