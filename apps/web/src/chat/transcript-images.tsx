import type { PageImageBlock } from "@tandem/contracts";
import { ImageIcon, ImageOffIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useConnected } from "@/rpc/connection.tsx";

/** Same-origin images use the HttpOnly session cookie, never a JS-visible credential or URL token. */
export function TranscriptImages({ images, className }: { images: readonly PageImageBlock[]; className?: string }) {
  const { imageUrl } = useConnected();
  if (images.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {images.map((image, index) => {
        const url = image.ref === undefined ? undefined : imageUrl(image.ref);
        return <TranscriptImage key={url ?? `queued-${index}`} url={url} label={`Image ${index + 1}`} />;
      })}
    </div>
  );
}
function TranscriptImage({ url, label }: { url?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (url === undefined || failed) {
    const why =
      url === undefined
        ? `${label} is sent once the message is taken`
        : `${label} could not be loaded. Reload the page to retry.`;
    return (
      <Tooltip>
        <TooltipTrigger render={<Button variant="outline" size="icon-lg" className="size-24" aria-label={why} />}>
          {failed ? <ImageOffIcon /> : <ImageIcon />}
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
        <img
          src={url}
          alt={label}
          loading="lazy"
          onError={() => setFailed(true)}
          className="max-h-40 max-w-60 object-contain"
        />
      </DialogTrigger>
      <DialogContent className="max-w-[90vw] sm:max-w-[90vw]">
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <img src={url} alt={label} className="max-h-[80vh] w-full object-contain" />
      </DialogContent>
    </Dialog>
  );
}
