import type { RunTps } from "@tandem/contracts";
import { Button } from "@/components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.tsx";
import { formatCacheHitPercent } from "./cache-hit.ts";

/** One reading: its number, and the words around it (`out 11`, `2.7 tok/s`), with what it measures. */
type Metric = { before?: string; value: string; after?: string; detail: string };

function labelOf(metric: Metric): string {
  return [metric.before, metric.value, metric.after].filter((part) => part !== undefined).join(" ");
}

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
  const metrics: Metric[] = [
    {
      value: tps.tokensPerSecond.toFixed(1),
      after: "tok/s",
      detail: "Output tokens divided by measured full-run duration",
    },
    { value: `${tps.seconds.toFixed(1)}s`, detail: "Measured full-run wall-clock duration" },
    { before: "out", value: tps.outputTokens.toLocaleString(), detail: "Assistant output tokens in the last run" },
    { before: "in", value: tps.inputTokens.toLocaleString(), detail: "Uncached input tokens in the last run" },
    {
      before: "total",
      value: tps.totalTokens.toLocaleString(),
      detail: "Total tokens reported by the provider in the last run",
    },
    ...(cacheHit === null
      ? []
      : [
          {
            before: "cache",
            value: `${cacheHit}%`,
            detail: "Cache-read tokens / (input + cache-read + cache-write tokens)",
          },
        ]),
  ];
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            aria-label="Run metrics details"
            className="h-auto max-w-full justify-start whitespace-normal px-1 py-0.5 text-[11px] font-normal text-muted-foreground sm:px-2 sm:py-1 sm:text-xs"
          />
        }
      >
        {/* No separators: the number is the darker part and a wide gap sits between metrics, so each reads as one unit. */}
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0 tabular-nums sm:gap-x-4 sm:gap-y-1">
          {metrics.map((metric) => (
            <span key={metric.detail} className="whitespace-nowrap">
              {metric.before !== undefined && `${metric.before} `}
              <span className="text-foreground">{metric.value}</span>
              {metric.after !== undefined && ` ${metric.after}`}
            </span>
          ))}
        </span>
      </PopoverTrigger>
      <PopoverContent aria-label="Run metrics details" className="max-w-[calc(100vw-2rem)] text-xs">
        <dl className="grid gap-2">
          {metrics.map((metric) => (
            <div key={metric.detail}>
              <dt className="font-medium">{labelOf(metric)}</dt>
              <dd className="text-muted-foreground">{metric.detail}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
