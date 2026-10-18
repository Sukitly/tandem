import { useEffect, useState } from "react";
import { WaitingDots } from "./waiting-dots.tsx";

const SILENT_GAP_MS = 2000;

/** The waiting dots at the end of the transcript, while the agent works and nothing on screen moves. */
export function SilentGap({ silent, turnHasContent }: { silent: boolean; turnHasContent: boolean }) {
  const [sustained, setSustained] = useState(false);
  useEffect(() => {
    if (!silent) {
      setSustained(false);
      return;
    }
    const timer = setTimeout(() => setSustained(true), SILENT_GAP_MS);
    return () => clearTimeout(timer);
  }, [silent]);

  if (!silent || (turnHasContent && !sustained)) return null;
  return <WaitingDots />;
}
