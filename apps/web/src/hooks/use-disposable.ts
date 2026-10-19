import { useEffect, useRef } from "react";

/** React StrictMode replays setup. Defer terminal disposal so the replay can renew the same resource lease. */
export function useDisposable(resource: { dispose(): void }, enabled = true): void {
  const lifetime = useRef<{ resource: typeof resource } | null>(null);
  useEffect(() => {
    const lease = { resource };
    lifetime.current = lease;
    if (!enabled) return;
    return () =>
      queueMicrotask(() => {
        if (lifetime.current === lease || lifetime.current?.resource !== resource) resource.dispose();
      });
  }, [resource, enabled]);
}
