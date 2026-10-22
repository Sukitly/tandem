import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import type { KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";

type LightboxImage = {
  src: string;
  /** Shown under the image and read by screen readers. */
  name?: string;
};

type ImageLightboxProps = {
  images: LightboxImage[];
  /** The image showing, or `null` while the lightbox is closed. */
  index: number | null;
  /** Called with another index to move, or `null` to close. */
  onIndexChange: (index: number | null) => void;
  /**
   * Text for the controls, for screen readers. `image` names the picture when
   * it has no name of its own.
   */
  labels?: { close?: string; previous?: string; next?: string; image?: string };
};

/**
 * A picture at the largest size the window allows, over a dark backdrop. With
 * several pictures the arrow keys and the buttons move between them. A click on
 * the backdrop, Escape, or the close button closes it. It does not zoom.
 *
 * Controlled: keep the index in your own state, `null` when closed.
 */
function ImageLightbox({ images, index, onIndexChange, labels }: ImageLightboxProps) {
  const image = index === null ? undefined : images[index];
  const several = images.length > 1;
  const hasPrevious = index !== null && index > 0;
  const hasNext = index !== null && index < images.length - 1;

  function handleKeyDown(event: KeyboardEvent) {
    if (index === null) {
      return;
    }

    if (event.key === "ArrowLeft" && hasPrevious) {
      event.preventDefault();
      onIndexChange(index - 1);
    }

    if (event.key === "ArrowRight" && hasNext) {
      event.preventDefault();
      onIndexChange(index + 1);
    }
  }

  return (
    <Dialog
      open={image !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          onIndexChange(null);
        }
      }}
    >
      <DialogPortal>
        <DialogOverlay className="bg-black/80 supports-backdrop-filter:backdrop-blur-sm motion-reduce:animate-none" />
        <DialogPrimitive.Popup
          data-slot="image-lightbox"
          onKeyDown={handleKeyDown}
          // Sized to the picture rather than the whole screen, so a click
          // beside it lands on the backdrop and closes the lightbox. `w-max`,
          // because a box placed from `left: 50%` is otherwise offered only the
          // right half of the window.
          className="gap-3 fixed top-1/2 left-1/2 z-50 flex w-max max-w-[95vw] -translate-x-1/2 -translate-y-1/2 flex-col items-center outline-none duration-100 motion-reduce:animate-none data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0"
        >
          <DialogTitle className="sr-only">{image?.name ?? labels?.image ?? "Image"}</DialogTitle>
          {image && (
            // The controls sit on the picture, so they follow it however it is
            // sized.
            <div className="relative flex">
              <img
                key={image.src}
                src={image.src}
                alt=""
                className="rounded-lg max-h-[80dvh] max-w-[90vw] object-contain select-none"
              />
              <DialogClose render={<Button variant="secondary" size="icon" className="top-2 right-2 absolute" />}>
                <XIcon />
                <span className="sr-only">{labels?.close ?? "Close"}</span>
              </DialogClose>
              {several && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    disabled={!hasPrevious}
                    aria-label={labels?.previous ?? "Previous image"}
                    onClick={() => index !== null && onIndexChange(index - 1)}
                    className="left-2 absolute top-1/2 -translate-y-1/2"
                  >
                    <ChevronLeftIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    disabled={!hasNext}
                    aria-label={labels?.next ?? "Next image"}
                    onClick={() => index !== null && onIndexChange(index + 1)}
                    className="right-2 absolute top-1/2 -translate-y-1/2"
                  >
                    <ChevronRightIcon />
                  </Button>
                </>
              )}
            </div>
          )}
          {(image?.name || several) && (
            <p className="text-sm text-white/80 tabular-nums">
              {image?.name}
              {image?.name && several ? "  ·  " : ""}
              {several && index !== null ? `${index + 1} / ${images.length}` : ""}
            </p>
          )}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}

export { ImageLightbox, type LightboxImage };
