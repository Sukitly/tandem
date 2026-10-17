import { CheckIcon, CopyIcon } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function useCopyText(text: string) {
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setCopied(false);
    try {
      if (navigator.clipboard === undefined) throw new Error("Clipboard access is unavailable in this browser");
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (error) {
      toast.error("Could not copy", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { copied, pending, copy };
}

/** Compose the generated Button instead of modifying the generated copy control that swallows clipboard failures. */
export function CodeCopyButton({
  value,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick"> & { value: string }) {
  const { copied, pending, copy } = useCopyText(value);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        {...props}
        data-slot="code-block-copy-button"
        data-copied={copied || undefined}
        aria-label={copied ? "Copied" : (props["aria-label"] ?? "Copy code")}
        disabled={disabled || pending}
        onClick={() => void copy()}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}
