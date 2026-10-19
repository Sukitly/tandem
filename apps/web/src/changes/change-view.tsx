import type { ChangedFile, FilePatch } from "@tandem/contracts";
import { AlertCircleIcon, Columns2Icon, Rows2Icon } from "lucide-react";
import { Suspense } from "react";
import { userPreferences } from "@/app/user-preferences.ts";
import type { ProjectComments } from "@/comments/project-comments.ts";
import { IconAction } from "@/components/icon-action.tsx";
import { LoadingView } from "@/components/loading-view.tsx";
import {
  ReaderBody,
  ReaderCloseButton,
  ReaderExpandButton,
  ReaderHeader,
  ReaderPath,
  useReader,
} from "@/components/reader.tsx";
import { ReaderWrapButton } from "@/components/reader-surface.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { lazyExport } from "@/lib/lazy-export.ts";
import { usePreference } from "@/lib/preferences.ts";
import type { DiffReadingState } from "./change-diff.tsx";
import { ADDITIONS_COLOR, countParts, DELETIONS_COLOR, statusLabel } from "./change-status.ts";
import type { ChangeTarget } from "./change-target.ts";

/** The diff draws with `@pierre/diffs`, which is loaded when the first one is drawn. */
const ChangeDiff = lazyExport(() => import("./change-diff.tsx"), "ChangeDiff");

/** The selected file's patch, with the controls that change how it is shown. */
export function ChangeView({
  reading,
  file,
  patch,
  failure,
  comments,
  reveal,
  onClose,
}: {
  reading: DiffReadingState;
  file: ChangedFile;
  patch: FilePatch | null;
  failure: string | null;
  comments: ProjectComments;
  reveal?: ChangeTarget;
  onClose(): void;
}) {
  const { expanded: zoomed } = useReader();
  const isMobile = useIsMobile();
  const [inlineStyle, setInlineStyle] = usePreference(userPreferences.diffStyle.inline);
  const [fullscreenStyle, setFullscreenStyle] = usePreference(userPreferences.diffStyle.fullscreen);
  const [narrowStyle, setNarrowStyle] = usePreference(userPreferences.diffStyle.narrow);
  const [inlineWrap, setInlineWrap] = usePreference(userPreferences.diffWrap.inline);
  const [fullscreenWrap, setFullscreenWrap] = usePreference(userPreferences.diffWrap.fullscreen);
  const styled = isMobile ? narrowStyle : zoomed ? fullscreenStyle : inlineStyle;
  const wrap = zoomed ? fullscreenWrap : inlineWrap;
  const next = styled === "split" ? "unified" : "split";
  const parts = countParts(file.additions, file.deletions);

  const toggleWrap = (): void => (zoomed ? setFullscreenWrap : setInlineWrap)(!wrap);
  const toggleStyled = (): void => (isMobile ? setNarrowStyle : zoomed ? setFullscreenStyle : setInlineStyle)(next);

  return (
    <>
      <ReaderHeader>
        <ReaderPath path={file.path} title={statusLabel(file.status, file.from)} />
        {parts.length > 0 && (
          <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
            {parts.map((part) => (
              <span key={part.kind} className={part.kind === "additions" ? ADDITIONS_COLOR : DELETIONS_COLOR}>
                {part.text}
              </span>
            ))}
          </span>
        )}
        <ReaderWrapButton wrap={wrap} onToggle={toggleWrap} />
        <IconAction
          label={next === "split" ? "Show the diff in two columns" : "Show the diff in one column"}
          onClick={toggleStyled}
          tooltip={next === "split" ? "Two columns" : "One column"}
        >
          {styled === "split" ? <Columns2Icon /> : <Rows2Icon />}
        </IconAction>
        <ReaderExpandButton />
        <ReaderCloseButton label="Close the diff" onClose={onClose} />
      </ReaderHeader>
      <ReaderBody>
        {failure !== null ? (
          <div className="p-3">
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Cannot read the diff</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          </div>
        ) : patch === null ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia>
                <Spinner />
              </EmptyMedia>
            </EmptyHeader>
          </Empty>
        ) : (
          <Suspense fallback={<LoadingView />}>
            <ChangeDiff
              reading={reading}
              key={file.path}
              path={file.path}
              patch={patch}
              style={styled}
              wrap={wrap}
              comments={comments}
              reveal={reveal}
            />
          </Suspense>
        )}
      </ReaderBody>
    </>
  );
}
