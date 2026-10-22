import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ModelSummary } from "@tandem/contracts";
import { KeyRoundIcon } from "lucide-react";
import { ModelSelector, type ModelSelectorModel } from "@/components/agent/model-selector.tsx";
import { Button } from "@/components/ui/button.tsx";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu.tsx";
import { useCommand } from "@/hooks/use-command.ts";
import { useProvidersDialog } from "@/models/providers-dialog.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import type { AgentChoice } from "./status-bar.tsx";

/**
 * A model is told apart by its provider and its id together: two providers may offer a model of the same id. The id
 * of the selector is only ever looked up in the list it was made from, never taken apart.
 */
const selectorId = (model: Pick<ModelSummary, "provider" | "modelId">): string => `${model.provider}/${model.modelId}`;

/** A thinking level as a person reads it: `off` is Off, and the others are their names. */
function levelName(level: string): string {
  return level === "off" ? "Off" : (level[0]?.toUpperCase() ?? "") + level.slice(1);
}

/** The models under the name of their provider, in the order the providers first appear, with their own levels. */
function selectorModels(models: readonly ModelSummary[], providers: readonly { id: string; name: string }[]) {
  return models.map((model): ModelSelectorModel => {
    const group = providers.find((provider) => provider.id === model.provider)?.name ?? model.provider;
    return {
      id: selectorId(model),
      name: model.name,
      group,
      // The name and the id are searched already; the provider's name is how a person looks for a group of them.
      keywords: [group],
      efforts: model.thinkingLevels.map((level) => ({ id: level, name: levelName(level) })),
    };
  });
}

/**
 * The model and the thinking level of the agent, in one menu: the models under their providers, the thinking levels of
 * the chosen one a row down, and a way to the providers. A choice is saved to the conversation, or to the new one before
 * it exists, and then as what new conversations start with; a failure of either is told in a toast.
 */
export function ModelChoice({
  agent,
  current,
  onConfigure,
}: {
  agent: AgentChoice | undefined;
  /** The summary of the model the agent has, when it is one that is available. */
  current: ModelSummary | undefined;
  onConfigure: (change: AgentChoice) => Promise<void>;
}) {
  const { models } = useConnected();
  const state = useReplicatedState(models.state);
  const providers = useProvidersDialog();
  const saveModel = useCommand({ failure: "Could not save model selection" });
  const saveThinking = useCommand({ failure: "Could not save thinking level" });
  const available = state?.models ?? [];

  if (available.length === 0) {
    return (
      <Button variant="ghost" size="xs" onClick={() => providers.open()}>
        <KeyRoundIcon />
        Sign in to a model provider
      </Button>
    );
  }

  const chooseModel = (id: string): void => {
    const model = available.find((candidate) => selectorId(candidate) === id);
    if (model === undefined || saveModel.pending) return;
    const ref = { provider: model.provider, modelId: model.modelId };
    void saveModel.run(async () => {
      await onConfigure({ model: ref });
      await models.setDefaultModel(ref, BACKGROUND_CONTEXT);
    });
  };

  const chooseThinking = (thinkingLevel: string): void => {
    void saveThinking.run(async () => {
      await onConfigure({ thinkingLevel });
      await models.setDefaultThinkingLevel(thinkingLevel, BACKGROUND_CONTEXT);
    });
  };

  return (
    <ModelSelector
      models={selectorModels(available, state?.providers ?? [])}
      // Always a string, so that the choice is the one that was saved: a model that is not available is none of them.
      value={current === undefined ? "" : selectorId(current)}
      // The level that goes with the model is not passed on: the server lowers a level that the model has not got, and
      // what is shown is what it did.
      onValueChange={chooseModel}
      effort={agent?.thinkingLevel ?? "off"}
      onEffortChange={chooseThinking}
      effortLabel="Thinking"
      placeholder={agent?.model === undefined ? "Choose a model" : `${agent.model.modelId} (unavailable)`}
      disabled={saveModel.pending || saveThinking.pending}
      align="start"
      footer={
        <DropdownMenuItem onClick={() => providers.open()}>
          <KeyRoundIcon />
          Model providers…
        </DropdownMenuItem>
      }
    />
  );
}
