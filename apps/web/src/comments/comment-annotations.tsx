import type { CommentThread } from "@tandem/contracts";
import type { RefObject } from "react";
import { AnchoredCommentEditor } from "./anchored-comment-editor.tsx";
import { CommentThreadBox } from "./comment-box.tsx";
import type { ProjectComments } from "./project-comments.ts";
import type { PlacedDraft, useCommentDrafts } from "./use-comment-drafts.ts";

export type CommentAnnotation = { kind: "thread"; thread: CommentThread } | { kind: "draft"; draft: PlacedDraft };
export interface CommentPresentation {
  comments: ProjectComments;
  drafts: ReturnType<typeof useCommentDrafts>;
  view?: RefObject<HTMLDivElement | null>;
}

/** Shared presentation, independent of plain DOM, virtual files and split/unified diff renderers. */
export function CommentAnnotationView({
  annotation,
  comments,
  drafts,
  view,
  className,
}: CommentPresentation & {
  annotation: CommentAnnotation | undefined;
  className?: string;
}) {
  if (annotation === undefined) return null;
  return annotation.kind === "draft" ? (
    <AnchoredCommentEditor
      key={annotation.draft.record.id}
      draft={annotation.draft}
      store={drafts.store}
      comments={comments}
      view={view}
      className={className}
    />
  ) : (
    <CommentThreadBox thread={annotation.thread} comments={comments} view={view} className={className} />
  );
}

export function DetachedCommentDrafts(props: CommentPresentation) {
  return <CommentDraftList {...props} entries={props.drafts.detached} />;
}

/** Editors can live outside a virtualized renderer without losing their anchors or their input focus. */
export function CommentDraftList({
  comments,
  drafts,
  view,
  entries,
}: CommentPresentation & { entries: readonly PlacedDraft[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="max-h-1/2 shrink-0 overflow-auto border-b" aria-label="Pending review comments">
      {entries.map((draft) => (
        <CommentAnnotationView
          key={draft.record.id}
          annotation={{ kind: "draft", draft }}
          drafts={drafts}
          comments={comments}
          view={view}
        />
      ))}
    </section>
  );
}
