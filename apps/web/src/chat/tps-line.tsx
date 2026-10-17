import type { RunTps } from "@tandem/contracts";
import { Button } from "@/components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.tsx";
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
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            aria-label="Run metrics details"
            className="h-auto max-w-full justify-start whitespace-normal px-2 py-1 text-xs font-normal text-muted-foreground"
          />
        }
      >
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums">
          {metrics.map((metric, index) => (
            <span key={metric.detail} className="inline-flex items-baseline gap-2 whitespace-nowrap">
              {index > 0 && (
                <span aria-hidden="true" className="text-muted-foreground/50">
                  ·
                </span>
              )}
              <span>{metric.label}</span>
            </span>
          ))}
        </span>
      </PopoverTrigger>
      <PopoverContent aria-label="Run metrics details" className="max-w-[calc(100vw-2rem)] text-xs">
        <dl className="grid gap-2">
          {metrics.map((metric) => (
            <div key={metric.detail}>
              <dt className="font-medium">{metric.label}</dt>
              <dd className="text-muted-foreground">{metric.detail}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
