import type { ModelRef, ModelsState } from "@tandem/contracts";
import { useState } from "react";
import type { AgentChoice } from "./status-bar.tsx";

function sameModel(a: ModelRef | undefined, b: ModelRef | undefined): boolean {
  return a !== undefined && b !== undefined && a.provider === b.provider && a.modelId === b.modelId;
}

/** Resolves model selection and thinking level with server default fallbacks. */
export function useAgentChoice(available: ModelsState | undefined, initial: AgentChoice = {}) {
  const [chosen, setChosen] = useState<AgentChoice>(initial);

  const first = available?.models[0];
  const model =
    chosen.model ??
    available?.defaultModel ??
    (first === undefined ? undefined : { provider: first.provider, modelId: first.modelId });

  const levels = available?.models.find((candidate) => sameModel(candidate, model))?.thinkingLevels;
  const remembered = available?.defaultThinkingLevel;
  const thinkingLevel =
    chosen.thinkingLevel ??
    (remembered !== undefined && levels?.includes(remembered) === true ? remembered : undefined);

  const agent: AgentChoice = {
    ...(model === undefined ? {} : { model }),
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
  };

  const configure = async (change: AgentChoice): Promise<void> => {
    setChosen((current) => {
      const next = { ...current, ...change };
      const currentLevels = available?.models.find((candidate) => sameModel(candidate, next.model))?.thinkingLevels;
      if (
        change.model !== undefined &&
        next.thinkingLevel !== undefined &&
        currentLevels?.includes(next.thinkingLevel) !== true
      ) {
        delete next.thinkingLevel;
      }
      return next;
    });
  };

  return { agent, configure };
}
