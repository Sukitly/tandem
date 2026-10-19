import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { PublicAccess, PublicAccessStatus } from "@tandem/contracts";
import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/errors.ts";

/** A status in which the tunnel is neither being started nor being authorized: what a start has come to. */
export function isSettled(status: PublicAccessStatus): boolean {
  return status === "connected" || status === "failed" || status === "unavailable" || status === "none";
}

/**
 * Publishing this machine and stopping it. A start is under way from the moment it is asked for until the tunnel says
 * where it came to, which can be before the server answers the request, so the status ends it too.
 */
export function usePublishing(publicAccess: PublicAccess, status: PublicAccessStatus) {
  const [asked, setAsked] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isSettled(status)) setAsked(false);
  }, [status]);

  return {
    publishing: asked || !isSettled(status),
    stopping,
    /** Why the last start or stop failed, if it did. */
    error,
    async publish(input: { publicUrl: string; token: string }): Promise<void> {
      setAsked(true);
      setError(null);
      try {
        await publicAccess.publish(input, BACKGROUND_CONTEXT);
      } catch (failure) {
        setError(errorMessage(failure));
      } finally {
        setAsked(false);
      }
    },
    /** Whether the tunnel was stopped. */
    async stop(): Promise<boolean> {
      setStopping(true);
      setError(null);
      try {
        await publicAccess.unpublish(BACKGROUND_CONTEXT);
        return true;
      } catch (failure) {
        setError(errorMessage(failure));
        return false;
      } finally {
        setStopping(false);
      }
    },
  };
}
