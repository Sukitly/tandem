import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, reportFailure } from "@/lib/errors.ts";

export interface Command {
  /**
   * Runs `action`, unless another run of this command is still going. Resolves to whether it succeeded, and never
   * rejects: a failure is reported as the command's options say.
   */
  run(action: () => Promise<unknown>): Promise<boolean>;
  /** A run is going; what its caller disables meanwhile. */
  pending: boolean;
  /**
   * Why the last run failed, for a message beside what was attempted. `null` when the last run did not fail, or when
   * its failure is reported as a toast.
   */
  error: string | null;
  /** Forget the last failure. */
  reset(): void;
}

export interface CommandOptions {
  /** Report a failure as a toast with this title, with the reason beneath, instead of leaving it in `error`. */
  failure?: string;
}

/**
 * A command a page gives the server from an event: its pending state, one run at a time, and how it failed. It is the
 * one way components do this, so that none keeps its own `pending` and `error` or reports a failure its own way.
 * Failures are shown beside the action (`error`) when the person can correct and retry there, and as a toast (`failure`)
 * when they cannot.
 *
 * It holds plain state rather than a query client's, so it works above the snapshot cache too, in the dialogs the whole
 * page opens. A run that ends after the component is gone changes nothing, but its action has run.
 */
export function useCommand(options: CommandOptions = {}): Command {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  const failure = useRef(options.failure);
  failure.current = options.failure;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    // The ref answers a second run in the same tick, before a disabled button has been rendered.
    if (running.current) return false;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (cause) {
      if (failure.current !== undefined) reportFailure(failure.current, cause);
      else if (mounted.current) setError(errorMessage(cause));
      return false;
    } finally {
      running.current = false;
      if (mounted.current) setPending(false);
    }
  }, []);

  const reset = useCallback(() => setError(null), []);
  return { run, pending, error, reset };
}
