import type { ModelRef } from "@tandem/contracts";
import { cn } from "cn";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ContextUsageBadge } from "./context-usage.tsx";
import { ModelChoice } from "./model-choice.tsx";
import type { ContextUsage } from "./transcript.ts";

export interface AgentChoice {
  model?: ModelRef;
  thinkingLevel?: string;
}

/**
 * In the message box: the model and thinking level, what the conversation cost, and how full its context is.
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

  return (
    <div
      className={cn("flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs text-muted-foreground", className)}
    >
      <ModelChoice agent={agent} current={current} onConfigure={onConfigure} />
      <ContextUsageBadge usage={usage} contextWindow={current?.contextWindow ?? 0} />
    </div>
  );
}
