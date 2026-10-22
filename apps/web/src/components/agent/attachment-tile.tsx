import { cn } from "cn";
import { ImageOffIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";

import {
  Attachment,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";

type AttachmentTileProps = Omit<ComponentProps<typeof Attachment>, "children" | "orientation" | "size" | "title"> & {
  /**
   * `lg` is a 144px square, for where a thumbnail has to be read before it is
   * sent, such as in the box a message is typed in. It is 96px otherwise.
   * `auto` keeps a picture in its own proportions, not cropped to a square, up
   * to a height and as wide as the room it has. A file with no picture is the
   * same 96px square in every size.
   */
  size?: "default" | "lg" | "auto";
  /**
   * The file's name. A picture is the thumbnail alone, with the name as its
   * tooltip and what screen readers hear. A file with no picture has nothing else
   * to tell it apart, so its name is written on the tile.
   */
  name: string;
  /** An image address, shown as the thumbnail. Without one the file is an icon with its name. */
  src?: string;
  /** An icon of your own for a file that is not an image, in place of the files icon. It is 48px, so a thin stroke suits it. */
  icon?: ReactNode;
  /**
   * Added to the tooltip and read by screen readers, such as the size or what
   * went wrong. On a file it is written under the name.
   */
  description?: ReactNode;
  /**
   * What a tile says when its picture cannot be loaded, under the name. It is
   * then the tile of a file, red, with an icon of a crossed-out picture, so the
   * reader sees that something is missing and which picture it was, not an empty
   * frame. Defaults to "Could not load".
   */
  failedLabel?: ReactNode;
  /**
   * `uploading` and `processing` fade the thumbnail and show a spinner, `error`
   * turns the tile red, and `done` is the default.
   */
  state?: ComponentProps<typeof Attachment>["state"];
  /**
   * How far along an `uploading` or `processing` file is, from 0 to 100, drawn
   * as a bar along the bottom of the tile. Without it the spinner is all there
   * is. Say it in words with `description`, such as "45%", if the reader needs
   * the number.
   */
  progress?: number;
  /** Makes a picture open on a click, such as in a lightbox. Has no effect on a file with no picture. */
  onView?: () => void;
  /** Names the view button for screen readers. Defaults to "View" and the name. */
  viewLabel?: string;
  /**
   * Controls in the corner, such as a remove button. They sit above the view
   * button, so a click on one is not a click to view.
   */
  actions?: ReactNode;
};

/** The longest extension that is kept whole, with its dot: ".markdown" is 9. */
const MAX_EXTENSION = 10;

/**
 * A file name split into the part that may be cut and its extension, which is
 * kept, so a long name ends in ".xlsx" and not in an ellipsis. A name with no
 * extension, such as "Makefile", or only a dot at the start, such as ".env", is
 * not split.
 */
function splitName(name: string) {
  const dot = name.lastIndexOf(".");

  return dot > 0 && name.length - dot <= MAX_EXTENSION
    ? { stem: name.slice(0, dot), extension: name.slice(dot) }
    : undefined;
}

/**
 * A stack of pages with lines of text on the front one, from SVG Repo. The view
 * box is cut to the drawing, so it fills the box it is given.
 */
function FilesIcon(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="6 4 19 25" fill="currentColor" aria-hidden {...props}>
      <path d="M16.984 16.047h-8v0.906h8v-0.906zM16.984 19.047h-8v0.969h8v-0.969zM12.016 4.016v3.016h-3.032v3.016h-2.953v18.938h13.969v-3.031h2.953v-2.938h3.016v-19h-13.953zM19.031 28.016h-12.031v-17.063h12.031v17.063zM21.984 25.047h-1.984v-15h-10.047v-2.047h12.031v17.047zM25 22.047h-2.047v-15.016h-9.969v-2.047h12.016v17.063zM16.984 25.031h-8v0.969h8v-0.969zM16.984 22.016h-8v0.969h8v-0.969zM16.999 13.016h-8v1h8v-1z" />
    </svg>
  );
}

/**
 * One file in a frame. A picture is a 96px square (144px with `size="lg"`) that
 * it fills, cropped in the middle to do it, or with `size="auto"` it keeps its
 * proportions. The whole of it is what `onView` is for, such as in a lightbox. A file with no picture is the same square: an icon in the middle,
 * 48px, half of its height, and under the icon its name and what you say about
 * it, such as the size. A name that is too long is cut with an ellipsis, and
 * the extension is kept.
 *
 * It is the same tile in the box a message is typed in and in the transcript it
 * is sent to, so a file looks the same before and after.
 *
 * A picture that cannot be loaded becomes the tile of a file in the error state,
 * with `failedLabel` under its name. Giving the tile another `src` tries again.
 */
function AttachmentTile({
  name,
  src,
  icon,
  description,
  failedLabel = "Could not load",
  state,
  progress,
  size = "default",
  onView,
  viewLabel,
  actions,
  className,
  ...props
}: AttachmentTileProps) {
  // The address that failed and not a flag, so a tile given another one tries
  // it, and a picture that loads again after it was fixed is not stuck.
  const [failedSrc, setFailedSrc] = useState<string>();
  const failed = src !== undefined && src === failedSrc;
  const shownState = failed ? "error" : state;
  const shownDescription = failed ? failedLabel : description;
  const busy = shownState === "uploading" || shownState === "processing";
  // The size is its own attribute: `data-size` is the shadcn/ui attachment's.
  // A file has no picture to keep in proportion, so `auto` is not for it.
  const tileSize = size === "lg" ? "lg" : undefined;
  const bar = busy && progress !== undefined && (
    <Progress value={progress} aria-label={name} className="inset-x-2 bottom-2 absolute" />
  );
  const title = shownDescription ? `${name}: ${shownDescription}` : name;
  const parts = splitName(name);

  if (!src || failed) {
    return (
      <Attachment
        {...props}
        orientation="vertical"
        size="sm"
        state={shownState}
        data-tile-size={tileSize}
        title={title}
        // The size of a picture, so a row is even. The shadcn/ui attachment makes
        // a vertical one with text 120px wide, with padding of its own and
        // children that wrap, so each of those is set back here.
        className={cn(
          "size-24 gap-1 has-data-[slot=attachment-content]:w-24 has-data-[slot=attachment-content]:px-1.5 has-data-[slot=attachment-content]:py-2 data-[tile-size=lg]:size-36 data-[tile-size=lg]:has-data-[slot=attachment-content]:w-36 flex-nowrap overflow-hidden",
          className,
        )}
      >
        {/* The icon is lighter than the text, so the name is read first, then the
            size, then the icon. It is 48px in the room the text leaves, and
            fades while the file is sent, with a spinner over it. It turns red
            with the frame on an error. */}
        <div
          aria-hidden
          className="text-muted-foreground/70 group-data-[state=error]/attachment:text-destructive relative min-h-0 flex-1"
        >
          <div
            data-busy={busy || undefined}
            className="[&>svg]:size-12 data-[busy=true]:opacity-40 group-data-[tile-size=lg]/attachment:[&>svg]:size-18 absolute inset-0 flex items-center justify-center"
          >
            {failed ? <ImageOffIcon /> : (icon ?? <FilesIcon />)}
          </div>
          {busy && <Spinner className="absolute inset-0 m-auto motion-reduce:animate-none" />}
        </div>
        <AttachmentContent className="text-center text-[11px] leading-[1.15] group-data-[orientation=vertical]/attachment:px-0 w-full flex-none">
          <AttachmentTitle>
            {parts ? (
              <>
                {/* The stem is cut with an ellipsis and the extension stays. It is two
                    elements, so the name is said whole for screen readers. */}
                <span aria-hidden className="flex justify-center">
                  <span className="min-w-0 truncate">{parts.stem}</span>
                  <span className="shrink-0">{parts.extension}</span>
                </span>
                <span className="sr-only">{name}</span>
              </>
            ) : (
              name
            )}
          </AttachmentTitle>
          {shownDescription && (
            <AttachmentDescription className="mt-0 text-[11px]">{shownDescription}</AttachmentDescription>
          )}
        </AttachmentContent>
        {bar}
        {actions && (
          <AttachmentActions className="group-data-[orientation=vertical]/attachment:top-2 group-data-[orientation=vertical]/attachment:right-2">
            {actions}
          </AttachmentActions>
        )}
      </Attachment>
    );
  }

  if (size === "auto") {
    return (
      <Attachment
        {...props}
        orientation="vertical"
        state={state}
        data-tile-size="auto"
        title={title}
        // The frame is the shadcn/ui attachment's own, so the corners, the border
        // and the ring are those of the style, and its size is the picture's. It
        // has no media part: that is a square the picture is cropped to.
        className={cn(
          "size-24 has-data-[slot=attachment-media]:p-0 data-[tile-size=lg]:size-36 data-[tile-size=auto]:size-auto overflow-hidden",
          className,
        )}
      >
        {/* `self-start`, or a column stretches the picture to the width of the
            frame, out of its proportions. Its height and width are what its
            file says, up to the ceiling and the room, and the frame is as big
            as it. */}
        <img
          src={src}
          alt=""
          data-busy={busy || undefined}
          onError={() => setFailedSrc(src)}
          className="max-h-60 data-[busy=true]:opacity-60 block h-auto w-auto max-w-full self-start"
        />
        {busy && <Spinner className="absolute inset-0 m-auto motion-reduce:animate-none" />}
        {bar}
        <span className="sr-only">
          {name}
          {description ? `, ${description}` : ""}
        </span>
        {onView && (
          <AttachmentTrigger
            aria-label={viewLabel ?? `View ${name}`}
            onClick={onView}
            className="cursor-zoom-in rounded-[inherit]"
          />
        )}
        {actions && (
          <AttachmentActions className="group-data-[orientation=vertical]/attachment:top-2 group-data-[orientation=vertical]/attachment:right-2">
            {actions}
          </AttachmentActions>
        )}
      </Attachment>
    );
  }

  return (
    <Attachment
      {...props}
      orientation="vertical"
      state={state}
      data-tile-size={tileSize}
      title={title}
      // The frame is the shadcn/ui attachment's own, with the padding taken off
      // so a picture reaches its edge, and clipped to its rounded corners. Its
      // border is what an error turns red.
      className={cn(
        "size-24 has-data-[slot=attachment-media]:p-0 data-[tile-size=lg]:size-36 data-[tile-size=auto]:size-auto overflow-hidden",
        className,
      )}
    >
      <AttachmentMedia
        variant="image"
        // The media is the square of the frame already: the picture is cropped
        // to fill it, and the frame rounds the corners.
        className="rounded-none"
      >
        <img src={src} alt="" onError={() => setFailedSrc(src)} />
        {busy && <Spinner className="absolute motion-reduce:animate-none" />}
      </AttachmentMedia>
      {bar}
      <span className="sr-only">
        {name}
        {description ? `, ${description}` : ""}
      </span>
      {onView && (
        // Over the whole tile, under the actions, which sit above it.
        <AttachmentTrigger
          aria-label={viewLabel ?? `View ${name}`}
          onClick={onView}
          className="cursor-zoom-in rounded-[inherit]"
        />
      )}
      {actions && (
        <AttachmentActions className="group-data-[orientation=vertical]/attachment:top-2 group-data-[orientation=vertical]/attachment:right-2">
          {actions}
        </AttachmentActions>
      )}
    </Attachment>
  );
}

export { AttachmentTile, type AttachmentTileProps };
