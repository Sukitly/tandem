/** Browser lifecycle hints are optional; the client also runs without a DOM. */
export function onConnectionWake(wake: () => void): () => void {
  const page = typeof document === "undefined" ? undefined : document;
  const browser = typeof window === "undefined" ? undefined : window;
  const listener = (): void => {
    if (page?.visibilityState === "hidden") return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    wake();
  };
  page?.addEventListener("visibilitychange", listener);
  for (const event of ["online", "pageshow", "focus"]) browser?.addEventListener(event, listener);
  return () => {
    page?.removeEventListener("visibilitychange", listener);
    for (const event of ["online", "pageshow", "focus"]) browser?.removeEventListener(event, listener);
  };
}

export const CONNECTION_TIMEOUT_MS = 10_000;
export const PROBE_TIMEOUT_MS = 5_000;
export const PROBE_INTERVAL_MS = 30_000;

/** Bound the whole operation, even if its implementation fails to settle on abort. */
export async function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error("Connection timed out")), timeoutMs);
  let stop = (): void => {};
  try {
    controller.signal.throwIfAborted();
    const cancelled = new Promise<never>((_, reject) => {
      const listener = (): void => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", listener, { once: true });
      stop = () => controller.signal.removeEventListener("abort", listener);
    });
    return await Promise.race([run(controller.signal), cancelled]);
  } finally {
    clearTimeout(timer);
    stop();
    parent?.removeEventListener("abort", abort);
  }
}
