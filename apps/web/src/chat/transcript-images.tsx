import type { PageImageBlock } from "@tandem/contracts";
import { ImageIcon, ImageOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useConnected } from "@/rpc/connection.tsx";

/**
 * The images of a message as thumbnails, each fetched from the server when shown; clicking one shows it whole. An
 * image of a message still queued has nowhere to be fetched from yet, and shows as a placeholder.
 */
export function TranscriptImages({ images, className }: { images: readonly PageImageBlock[]; className?: string }) {
  if (images.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {images.map((image, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a message's images never change.
        <TranscriptImage key={index} image={image} label={`Image ${index + 1}`} />
      ))}
    </div>
  );
}

function TranscriptImage({ image, label }: { image: PageImageBlock; label: string }) {
  const shown = useImageUrl(image);
  if (shown.status === "loading") return <Skeleton className="size-24" />;
  if (shown.status !== "ready") {
    // Why there is no image to show, on the placeholder's tooltip: still queued, or it could not be loaded.
    const why = shown.status === "queued" ? `${label} is sent once the message is taken` : shown.reason;
    return (
      <Tooltip>
        <TooltipTrigger render={<Button variant="outline" size="icon-lg" className="size-24" aria-label={why} />}>
          {shown.status === "queued" ? <ImageIcon /> : <ImageOffIcon />}
        </TooltipTrigger>
        <TooltipContent>{why}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="outline" className="h-auto p-0" aria-label={`Show ${label.toLowerCase()}`} />}
      >
        <img src={shown.url} alt={label} className="max-h-40 max-w-60 object-contain" />
      </DialogTrigger>
      <DialogContent className="max-w-[90vw] sm:max-w-[90vw]">
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <img src={shown.url} alt={label} className="max-h-[80vh] w-full object-contain" />
      </DialogContent>
    </Dialog>
  );
}

/** An image as the transcript can show it. */
type ShownImage =
  | { status: "loading" }
  | { status: "ready"; url: string }
  /** A message still queued has no entry to fetch the image from yet. */
  | { status: "queued" }
  | { status: "failed"; reason: string };

/** The image's bytes as a URL while it is shown, or why there are none. */
function useImageUrl(image: PageImageBlock): ShownImage {
  const { fetchImage } = useConnected();
  const [shown, setShown] = useState<ShownImage>(
    image.ref === undefined ? { status: "queued" } : { status: "loading" },
  );
  const ref = image.ref;
  const key = ref === undefined ? "" : `${ref.conversationId}/${ref.entryId}/${ref.messageIndex}/${ref.blockIndex}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `ref`, which is a new object each revision.
  useEffect(() => {
    if (ref === undefined) {
      setShown({ status: "queued" });
      return;
    }
    const abort = new AbortController();
    let created: string | undefined;
    setShown({ status: "loading" });
    fetchImage(ref, abort.signal).then(
      (blob) => {
        created = URL.createObjectURL(blob);
        setShown({ status: "ready", url: created });
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        setShown({ status: "failed", reason: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      abort.abort();
      if (created !== undefined) URL.revokeObjectURL(created);
    };
  }, [key, fetchImage]);
  return shown;
}
