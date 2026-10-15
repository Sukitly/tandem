import type * as React from "react";
import { Button } from "@/components/ui/button.tsx";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card.tsx";
import { Progress } from "@/components/ui/progress.tsx";

export interface ContextProps {
  usedTokens: number;
  maxTokens: number;
  cost?: number;
  label?: React.ReactNode;
  rows?: Array<{ label: string; value: string | number }>;
  className?: string;
}

function formatTokens(value: number): string {
  if (value < 1000) {
    return String(value);
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

function formatCost(dollars: number): string {
  return `$${dollars < 1 ? dollars.toFixed(3) : dollars.toFixed(2)}`;
}

/**
 * Context shows how much of the model's context window the conversation has used.
 * Follows the shadcn/ui AI Elements Context pattern.
 */
export function Context({ usedTokens, maxTokens, cost, label, rows, className }: ContextProps) {
  const percent = maxTokens > 0 ? Math.min(100, Math.round((usedTokens / maxTokens) * 100)) : 0;

  const defaultRows: Array<{ label: string; value: string | number }> = [
    { label: "Used tokens", value: formatTokens(usedTokens) },
    { label: "Context window", value: formatTokens(maxTokens) },
  ];
  if (cost !== undefined) {
    defaultRows.push({ label: "Total cost", value: formatCost(cost) });
  }

  const displayRows = rows ?? defaultRows;

  return (
    <HoverCard>
      <HoverCardTrigger delay={10} closeDelay={100} render={<Button variant="ghost" size="xs" className={className} />}>
        {label ?? `${percent}% context`}
      </HoverCardTrigger>
      <HoverCardContent className="flex w-64 flex-col gap-3 p-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-foreground">Context Window</span>
          <span className="text-muted-foreground font-mono tabular-nums">
            {formatTokens(usedTokens)} / {formatTokens(maxTokens)}
          </span>
        </div>
        <Progress value={percent} aria-label="Context used" className="h-1.5" />
        <div className="flex flex-col gap-1 text-xs">
          {displayRows.map((row) => (
            <div key={row.label} className="flex justify-between gap-3">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-mono tabular-nums">{row.value}</span>
            </div>
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
