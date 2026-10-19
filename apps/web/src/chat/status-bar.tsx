import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ModelRef } from "@tandem/contracts";
import { cn } from "cn";
import { useCommand } from "@/hooks/use-command.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ContextUsageBadge } from "./context-usage.tsx";
import { ModelPicker } from "./model-picker.tsx";
import { ThinkingSelector } from "./thinking-selector.tsx";
import type { ContextUsage } from "./transcript.ts";

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
  const save = useCommand({ failure: "Could not save thinking level" });
  const { pending } = save;
  const contextWindow = current?.contextWindow ?? 0;

  const chooseThinking = (thinkingLevel: string): void => {
    void save.run(async () => {
      await onConfigure({ thinkingLevel });
      await models.setDefaultThinkingLevel(thinkingLevel, BACKGROUND_CONTEXT);
    });
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
