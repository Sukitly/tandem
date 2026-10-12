import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { PromptTemplateSummary } from "@tandem/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnected } from "./connection.tsx";

/**
 * A project's slash commands, read from disk. A snapshot, not replicated state: it is read when the project changes,
 * and again when `refresh` is called. A read that fails leaves no commands rather than an error, since the composer
 * only offers what it has.
 */
export function usePrompts(workspaceId: number | undefined): {
  commands: PromptTemplateSummary[];
  refresh: () => void;
} {
  const { prompts } = useConnected();
  const [commands, setCommands] = useState<PromptTemplateSummary[]>([]);
  // A read that is superseded, by another read or by the hook going away, does not write its result.
  const readId = useRef(0);

  const load = useCallback(() => {
    const id = ++readId.current;
    if (workspaceId === undefined) {
      setCommands([]);
      return;
    }
    prompts.list(workspaceId, BACKGROUND_CONTEXT).then(
      (list) => {
        if (readId.current === id) setCommands(list);
      },
      () => {
        if (readId.current === id) setCommands([]);
      },
    );
  }, [prompts, workspaceId]);

  useEffect(() => {
    load();
    return () => {
      readId.current += 1;
    };
  }, [load]);

  return { commands, refresh: load };
}
