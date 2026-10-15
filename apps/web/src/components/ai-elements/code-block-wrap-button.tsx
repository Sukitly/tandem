import { WrapTextIcon } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { cn } from "@/lib/utils.ts";

export interface CodeBlockWrapButtonProps extends Omit<React.ComponentProps<typeof Button>, "children"> {
  wrap: boolean;
  onWrapChange: (wrap: boolean) => void;
}

/**
 * Toggle button for wrapping code lines, composed outside UI primitives.
 */
export function CodeBlockWrapButton({
  wrap,
  onWrapChange,
  variant = "ghost",
  size = "icon-xs",
  className,
  ...props
}: CodeBlockWrapButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            data-slot="code-block-wrap-button"
            data-wrapped={wrap || undefined}
            variant={variant}
            size={size}
            className={cn(
              "text-muted-foreground hover:text-foreground",
              wrap && "text-foreground bg-accent",
              className,
            )}
            onClick={() => onWrapChange(!wrap)}
            aria-label={wrap ? "Disable line wrapping" : "Enable line wrapping"}
            aria-pressed={wrap}
            {...props}
          />
        }
      >
        <WrapTextIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>
        <p>{wrap ? "Unwrap lines" : "Wrap lines"}</p>
      </TooltipContent>
    </Tooltip>
  );
}
