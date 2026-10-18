import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ModelRef } from "@tandem/contracts";
import { cn } from "cn";
import { useState } from "react";
import { toast } from "sonner";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ContextUsageBadge } from "./context-usage.tsx";
import { ModelPicker } from "./model-picker.tsx";
import { ThinkingSelector } from "./thinking-selector.tsx";
import type { ContextUsage } from "./transcript.ts";

export { formatCost, formatTokens } from "./context-usage.tsx";

export interface AgentChoice {
  model?: ModelRef;
  thinkingLevel?: string;
}

/**
 * Under the message box: the model and thinking level, what the conversation cost, and how full its context is.
 * `onConfigure` applies a new choice: to the conversation, or to a new one before it exists.
 */
export function StatusBar({
  agent,
  usage,
  onConfigure,
  className,
}: {
  agent: AgentChoice | undefined;
  usage: ContextUsage;
  onConfigure: (change: AgentChoice) => Promise<void>;
  className?: string;
}) {
  const { models } = useConnected();
  const state = useReplicatedState(models.state);
  const current = state?.models.find(
    (model) => model.provider === agent?.model?.provider && model.modelId === agent?.model?.modelId,
  );
  const [pending, setPending] = useState(false);
  const contextWindow = current?.contextWindow ?? 0;

  const report = (error: unknown): void => {
    toast.error("Could not save thinking level", {
      description: error instanceof Error ? error.message : String(error),
    });
  };

  const chooseThinking = (thinkingLevel: string): void => {
    if (pending) return;
    setPending(true);
    Promise.resolve()
      .then(() => onConfigure({ thinkingLevel }))
      .then(() => models.setDefaultThinkingLevel(thinkingLevel, BACKGROUND_CONTEXT))
      .catch(report)
      .finally(() => setPending(false));
  };

  return (
    <div
      className={cn("flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs text-muted-foreground", className)}
    >
      <ModelPicker selectedModel={agent?.model} current={current} onConfigure={onConfigure} />
      {current !== undefined && (
        <ThinkingSelector
          level={agent?.thinkingLevel ?? "off"}
          levels={current.thinkingLevels}
          disabled={pending}
          onSelect={chooseThinking}
        />
      )}
      <ContextUsageBadge usage={usage} contextWindow={contextWindow} />
    </div>
  );
}
