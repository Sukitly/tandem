import type { ChangedFile, FilePatch } from "@tandem/contracts";
import { AlertCircleIcon, Columns2Icon, Rows2Icon } from "lucide-react";
import { useState } from "react";
import type { ProjectComments } from "@/comments/project-comments.ts";
import { IconAction } from "@/components/icon-action.tsx";
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
import { preferences } from "@/lib/preferences.ts";
import { ChangeDiff, type DiffReadingState } from "./change-diff.tsx";
import { ADDITIONS_COLOR, countParts, DELETIONS_COLOR, statusLabel } from "./change-status.ts";
import type { ChangeTarget } from "./change-target.ts";

const DIFF_STYLE_MOBILE_KEY = "tandem.diffStyle.mobile";
const DIFF_STYLE_KEY = "tandem.diffStyle";
const DIFF_STYLE_ZOOMED_KEY = "tandem.diffStyle.zoomed";
const DIFF_WRAP_KEY = "tandem.diffWrap";
const DIFF_WRAP_ZOOMED_KEY = "tandem.diffWrap.zoomed";

export function storedDiffStyle(surface: "inline" | "fullscreen" | "narrow"): "split" | "unified" {
  if (surface === "narrow") return preferences.getItem(DIFF_STYLE_MOBILE_KEY) === "split" ? "split" : "unified";
  if (surface === "fullscreen") {
    return preferences.getItem(DIFF_STYLE_ZOOMED_KEY) === "unified" ? "unified" : "split";
  }
  const stored = preferences.getItem(DIFF_STYLE_KEY);
  return stored === "split" ? "split" : "unified";
}

export function storedDiffWrap(zoomed: boolean): boolean {
  if (zoomed) {
    return preferences.getItem(DIFF_WRAP_ZOOMED_KEY) === "true";
  }
  return preferences.getItem(DIFF_WRAP_KEY) === "true";
}

/** The selected file's patch, with the controls that change how it is shown. */
export function ChangeView({
  reading,
  file,
  patch,
  failure,
  inlineStyled,
  onInlineStyled,
  zoomedStyled,
  onZoomedStyled,
  inlineWrap,
  onInlineWrap,
  zoomedWrap,
  onZoomedWrap,
  comments,
  reveal,
  onClose,
}: {
  reading: DiffReadingState;
  file: ChangedFile;
  patch: FilePatch | null;
  failure: string | null;
  inlineStyled: "split" | "unified";
  onInlineStyled(style: "split" | "unified"): void;
  zoomedStyled: "split" | "unified";
  onZoomedStyled(style: "split" | "unified"): void;
  inlineWrap: boolean;
  onInlineWrap(wrap: boolean): void;
  zoomedWrap: boolean;
  onZoomedWrap(wrap: boolean): void;
  comments: ProjectComments;
  reveal?: ChangeTarget;
  onClose(): void;
}) {
  const { expanded: zoomed } = useReader();
  const isMobile = useIsMobile();
  const [mobileStyle, setMobileStyle] = useState(() => storedDiffStyle("narrow"));
  const styled = isMobile ? mobileStyle : zoomed ? zoomedStyled : inlineStyled;
  const wrap = zoomed ? zoomedWrap : inlineWrap;
  const next = styled === "split" ? "unified" : "split";
  const parts = countParts(file.additions, file.deletions);

  const toggleWrap = (): void => {
    const nextWrap = !wrap;
    preferences.setItem(zoomed ? DIFF_WRAP_ZOOMED_KEY : DIFF_WRAP_KEY, String(nextWrap));
    if (zoomed) {
      onZoomedWrap(nextWrap);
    } else {
      onInlineWrap(nextWrap);
    }
  };

  const toggleStyled = (): void => {
    if (isMobile) {
      setMobileStyle(next);
      preferences.setItem(DIFF_STYLE_MOBILE_KEY, next);
      return;
    }
    preferences.setItem(zoomed ? DIFF_STYLE_ZOOMED_KEY : DIFF_STYLE_KEY, next);
    if (zoomed) {
      onZoomedStyled(next);
    } else {
      onInlineStyled(next);
    }
  };

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
        )}
      </ReaderBody>
    </>
  );
}
