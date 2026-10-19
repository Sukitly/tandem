import { Context } from "@/components/ai-elements/context.tsx";
import type { ContextUsage } from "./transcript.ts";

export function formatCost(dollars: number): string {
  return `$${dollars < 1 ? dollars.toFixed(3) : dollars.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  return `${Math.round(tokens / 1000)}K`;
}

export function ContextUsageBadge({ usage, contextWindow }: { usage: ContextUsage; contextWindow: number }) {
  if (contextWindow <= 0) return null;
  const percent = Math.min(100, (usage.tokens / contextWindow) * 100);

  return (
    <div className="ml-auto flex shrink-0 items-center gap-1.5 max-[340px]:hidden">
      <span className="hidden font-mono tabular-nums sm:inline">{formatCost(usage.cost)}</span>
      <Context
        usedTokens={usage.tokens}
        maxTokens={contextWindow}
        cost={usage.cost}
        label={
          <>
            <span>{percent.toFixed(0)}%</span>
            <span className="hidden sm:inline"> of {formatTokens(contextWindow)}</span>
          </>
        }
      />
    </div>
  );
}
