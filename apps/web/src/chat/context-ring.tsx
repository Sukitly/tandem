import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { Button } from "@/components/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";

/** A compact context meter using the same accessible primitive as shadcn's linear Progress. */
export function ContextRing({ percent, tokens, capacity }: { percent: number; tokens: number; capacity: number }) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-xs" />} aria-label="Context usage details">
        <ProgressPrimitive.Root value={value} aria-label="Context used" className="size-4">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 -rotate-90">
            <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted" />
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              pathLength="100"
              strokeDasharray={`${value} 100`}
              className="text-primary"
            />
          </svg>
        </ProgressPrimitive.Root>
      </TooltipTrigger>
      <TooltipContent>
        {tokens.toLocaleString()} / {capacity.toLocaleString()} tokens · {value.toFixed(0)}% of context used
      </TooltipContent>
    </Tooltip>
  );
}
