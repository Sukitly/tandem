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
 * The active provider's rate-limit usage, as pi's `usage-widget` extension shows it: one bar per window with the used
 * share, when it resets, and how the spend compares with the pace of the window. It sits under the message box, which
 * is always there; a provider with no usage endpoint shows nothing, and a native OpenAI subscription shows a notice
 * instead of bars. The server reads the usage, so no credential reaches the page.
 */
export function UsageLine({ provider, active }: { provider: string | undefined; active?: boolean }) {
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
  return <UsageText usage={known} />;
}

export function UsageText({ usage }: { usage: ProviderUsage }) {
  return (
    <div className="grid gap-0.5">
      {usage.windows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {usage.windows.map((window) => (
            <WindowText key={window.label} window={window} />
          ))}
        </div>
      ) : (
        usage.notice !== undefined && <p className="truncate text-xs text-muted-foreground">{usage.notice}</p>
      )}
      {usage.error !== undefined && (
        <p className="truncate text-xs text-destructive">
          {usage.provider} usage: {usage.windows.length > 0 ? "refresh failed (stale data)" : "refresh failed"} —{" "}
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
        className="inline-flex items-center gap-2 tabular-nums"
      >
        <span>{window.label}</span>
        <Progress
          value={Math.max(0, Math.min(100, window.utilization))}
          aria-label={`${window.label} quota used`}
          className="w-24"
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
