import type { PageImageBlock } from "@tandem/contracts";
import { ImageIcon, ImageOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
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
  const url = useImageUrl(image);
  const [open, setOpen] = useState(false);
  if (url === undefined) return <Skeleton className="size-24" />;
  if (url === null) {
    return (
      <div className="flex size-24 items-center justify-center rounded-md border text-muted-foreground" title={label}>
        {image.ref === undefined ? (
          <ImageIcon aria-label={label} />
        ) : (
          <ImageOffIcon aria-label={`${label} not found`} />
        )}
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        className="cursor-zoom-in overflow-hidden rounded-md border"
        aria-label={`Show ${label.toLowerCase()}`}
        onClick={() => setOpen(true)}
      >
        <img src={url} alt={label} className="max-h-40 max-w-60 object-contain" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-[90vw]">
          <DialogTitle className="sr-only">{label}</DialogTitle>
          <img src={url} alt={label} className="max-h-[80vh] w-full object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A URL of the image's bytes while it is shown: `undefined` while it loads, `null` when there is none. */
function useImageUrl(image: PageImageBlock): string | null | undefined {
  const { fetchImage } = useConnected();
  const [url, setUrl] = useState<string | null | undefined>(image.ref === undefined ? null : undefined);
  const ref = image.ref;
  const key = ref === undefined ? "" : `${ref.conversationId}/${ref.entryId}/${ref.messageIndex}/${ref.blockIndex}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `ref`, which is a new object each revision.
  useEffect(() => {
    if (ref === undefined) {
      setUrl(null);
      return;
    }
    const abort = new AbortController();
    let created: string | undefined;
    setUrl(undefined);
    fetchImage(ref, abort.signal).then(
      (blob) => {
        created = URL.createObjectURL(blob);
        setUrl(created);
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        console.error(error);
        setUrl(null);
      },
    );
    return () => {
      abort.abort();
      if (created !== undefined) URL.revokeObjectURL(created);
    };
  }, [key, fetchImage]);
  return url;
}
