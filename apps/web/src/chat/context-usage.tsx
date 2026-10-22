import { ContextUsage as ContextWindow } from "@/components/agent/context-usage.tsx";
import type { ContextUsage } from "./transcript.ts";

export function formatCost(dollars: number): string {
  return `$${dollars < 1 ? dollars.toFixed(3) : dollars.toFixed(2)}`;
}

// The words around it are English, so the figures are too, whatever the browser's language is.
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function formatTokens(tokens: number): string {
  return compact.format(tokens);
}

export function ContextUsageBadge({ usage, contextWindow }: { usage: ContextUsage; contextWindow: number }) {
  if (contextWindow <= 0) return null;
  const percent = Math.min(100, Math.round((usage.tokens / contextWindow) * 100));

  return (
    <div className="ml-auto flex shrink-0 items-center gap-1.5 max-[340px]:hidden">
      <span className="hidden font-mono tabular-nums sm:inline">{formatCost(usage.cost)}</span>
      <ContextWindow
        meter="bar"
        used={usage.tokens}
        max={contextWindow}
        title="Context window"
        rows={[{ label: "Total cost", value: formatCost(usage.cost) }]}
        formatValue={formatTokens}
      >
        <span>{percent}%</span>
        <span className="hidden sm:inline"> of {formatTokens(contextWindow)}</span>
      </ContextWindow>
    </div>
  );
}
