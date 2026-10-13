import type { RunTps } from "@tandem/contracts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { formatCacheHitPercent } from "./cache-hit.ts";

/**
 * The last agent run, as pi's `tps` extension reports it after each run: the throughput, the tokens spent, the
 * cache-read share of the prompt, and how long the run took. It sits under the message box with the model and the
 * context, which are always there; the server computes every number.
 */
export function TpsLine({ tps }: { tps: RunTps }) {
  const cacheHit = formatCacheHitPercent(
    tps.cacheReadTokens,
    tps.inputTokens + tps.cacheReadTokens + tps.cacheWriteTokens,
  );
  const metrics = [
    { label: `${tps.tokensPerSecond.toFixed(1)} tok/s`, detail: "Output tokens divided by measured full-run duration" },
    { label: `${tps.seconds.toFixed(1)}s`, detail: "Measured full-run wall-clock duration" },
    { label: `out ${tps.outputTokens.toLocaleString()}`, detail: "Assistant output tokens in the last run" },
    { label: `in ${tps.inputTokens.toLocaleString()}`, detail: "Uncached input tokens in the last run" },
    {
      label: `total ${tps.totalTokens.toLocaleString()}`,
      detail: "Total tokens reported by the provider in the last run",
    },
    ...(cacheHit === null
      ? []
      : [{ label: `cache hit ${cacheHit}%`, detail: "Cache-read tokens / (input + cache-read + cache-write tokens)" }]),
  ];
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-2 text-xs font-normal text-muted-foreground tabular-nums">
      {metrics.map((metric, index) => (
        <span key={metric.detail} className="inline-flex items-baseline gap-2 whitespace-nowrap">
          {index > 0 && (
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
          )}
          <Tooltip>
            <TooltipTrigger render={<span />} title={metric.detail}>
              {metric.label}
            </TooltipTrigger>
            <TooltipContent>{metric.detail}</TooltipContent>
          </Tooltip>
        </span>
      ))}
    </p>
  );
}
