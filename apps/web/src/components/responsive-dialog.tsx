import { type ComponentProps, useEffect, useState } from "react";
import { DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Application dialogs fit the visible viewport, including browsers whose keyboard does not resize dvh. */
export function ResponsiveDialogContent({ className, style, ...props }: ComponentProps<typeof DialogContent>) {
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const visible = window.visualViewport;
    if (visible === null || visible === undefined) return;
    const update = () => setViewport({ height: visible.height, top: visible.offsetTop });
    update();
    visible.addEventListener("resize", update);
    visible.addEventListener("scroll", update);
    return () => {
      visible.removeEventListener("resize", update);
      visible.removeEventListener("scroll", update);
    };
  }, []);
  return (
    <DialogContent
      {...props}
      className={cn(className, "app-dialog max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain")}
      style={{
        ...style,
        ...(viewport === null
          ? {}
          : { maxHeight: Math.max(0, viewport.height - 32), top: viewport.top + viewport.height / 2 }),
      }}
    />
  );
}
