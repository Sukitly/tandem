import type { ComponentProps, ReactNode } from "react";
import { Button } from "./ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.tsx";

/** Accessible naming and tooltip composition live together; features supply behavior and icon content. */
export function IconAction({
  label,
  tooltip = label,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "aria-label"> & {
  label: string;
  tooltip?: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-xs" {...props} aria-label={label} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
