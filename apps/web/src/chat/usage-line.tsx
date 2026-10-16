import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ProviderUsage, UsageWindow } from "@tandem/contracts";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";

const DAY_SECONDS = 24 * 60 * 60;

/** Over the pace: the window is being spent faster than time passes. */
const AHEAD_COLOR = "text-red-600 dark:text-red-400";
/** Under the pace: the window is being spent slower than time passes. */
const BEHIND_COLOR = "text-emerald-600 dark:text-emerald-400";

/**
 * Select the appropriate quota windows when a provider defines distinct model-pool groups (e.g. Antigravity).
 * Aligns with pi's usage-widget extension behavior.
 */
export function resolveWindowsForModel(usage: ProviderUsage, modelId?: string): UsageWindow[] {
  if (!usage.groups) return usage.windows;
  const is3P = modelId ? /claude|gpt|3p/i.test(modelId) : false;
  const groupKey = is3P ? "claude-gpt" : "gemini";
  return usage.groups[groupKey] ?? usage.windows;
}

/**
 * The active provider's rate-limit usage, as pi's `usage-widget` extension shows it: one bar per window with the used
 * share, when it resets, and how the spend compares with the pace of the window. It sits under the message box, which
 * is always there; a provider with no usage endpoint shows nothing, and a native OpenAI subscription shows a notice
 * instead of bars. The server reads the usage, so no credential reaches the page.
 */
export function UsageLine({
  provider,
  modelId,
  active,
}: {
  provider: string | undefined;
  modelId?: string;
  active?: boolean;
}) {
  const { usage } = useConnected();
  const state = useReplicatedState(usage.state);

  // Read when the provider shown changes, forced, and again after each run, as the extension refreshes on session
  // start and on `agent_end`. The server decides whether an unforced read is due.
  useEffect(() => {
    if (provider === undefined) return;
    usage.refresh(provider, true, BACKGROUND_CONTEXT).catch(() => {});
  }, [usage, provider]);

  const running = useRef(active === true);
  useEffect(() => {
    const ended = running.current && active !== true;
    running.current = active === true;
    if (ended && provider !== undefined) usage.refresh(provider, false, BACKGROUND_CONTEXT).catch(() => {});
  }, [usage, provider, active]);

  const known = provider === undefined ? undefined : state?.providers[provider];
  if (known === undefined) return null;
  return <UsageText usage={known} modelId={modelId} />;
}

export function UsageText({ usage, modelId }: { usage: ProviderUsage; modelId?: string }) {
  const windows = resolveWindowsForModel(usage, modelId);
  return (
    <div className="grid min-w-0 gap-0.5">
      {windows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground sm:gap-x-5 sm:gap-y-2">
          {windows.map((window) => (
            <WindowText key={`${window.label}-${window.windowSeconds}`} window={window} />
          ))}
        </div>
      ) : (
        usage.notice !== undefined && <p className="truncate text-xs text-muted-foreground">{usage.notice}</p>
      )}
      {usage.error !== undefined && (
        <p className="truncate text-xs text-destructive">
          {usage.provider} usage: {windows.length > 0 ? "refresh failed (stale data)" : "refresh failed"} —{" "}
          {usage.error}
        </p>
      )}
    </div>
  );
}

function WindowText({ window }: { window: UsageWindow }) {
  const reset = formatResetTime(window.resetsAt, window.windowSeconds);
  const pace = paceOf(window);
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="xs" />}
        className="inline-flex max-w-full shrink-0 items-center gap-1.5 tabular-nums sm:gap-2"
      >
        <span>{window.label}</span>
        <Progress
          value={Math.max(0, Math.min(100, window.utilization))}
          aria-label={`${window.label} quota used`}
          className="w-16 sm:w-24"
        />
        <span>{window.utilization.toFixed(0)}%</span>
        {pace !== null && (
          <span className={pace.ahead ? AHEAD_COLOR : BEHIND_COLOR}>
            {pace.ahead ? "+" : "−"}
            {Math.abs(pace.diff).toFixed(1)}%
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>
        <div className="grid gap-1">
          <span>
            {window.label} quota: {window.utilization.toFixed(0)}% used
          </span>
          {reset !== "" && (
            <span>
              Resets {reset} ({new Date(window.resetsAt as string).toLocaleString()})
            </span>
          )}
          {pace !== null && (
            <span>
              {Math.abs(pace.diff).toFixed(1)} percentage points {pace.ahead ? "ahead of" : "behind"} elapsed-time pace
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** `14:30`, or `Sun 14:30` for a window of a day or more; `""` when the provider named no reset. */
function formatResetTime(resetsAt: string | undefined, windowSeconds: number): string {
  if (resetsAt === undefined) return "";
  const date = new Date(resetsAt);
  if (!Number.isFinite(date.getTime())) return "";
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (windowSeconds < DAY_SECONDS) return time;
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()]} ${time}`;
}

/** How far the spend is ahead of (or behind) the pace the window's elapsed time implies, in percent. */
export function paceOf(window: UsageWindow): { diff: number; ahead: boolean } | null {
  if (window.resetsAt === undefined) return null;
  const resetMs = new Date(window.resetsAt).getTime();
  if (!Number.isFinite(resetMs)) return null;
  const windowMs = window.windowSeconds * 1000;
  const elapsed = Date.now() - (resetMs - windowMs);
  const expected = Math.min(100, Math.max(0, (elapsed / windowMs) * 100));
  const diff = window.utilization - expected;
  return { diff, ahead: diff > 0 };
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
