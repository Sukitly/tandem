import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation, ModelRef, ModelSummary } from "@tandem/contracts";
import { CheckIcon, ChevronDownIcon, KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorSeparator,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import {
  PromptInputButton,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
} from "@/components/ai-elements/prompt-input";
import { useProvidersDialog } from "@/models/providers-dialog.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";

/** The conversation's model and thinking level, in the message box's footer. */
export function ModelPicker({
  conversation,
  agent,
}: {
  conversation: Conversation;
  agent: { model?: ModelRef; thinkingLevel?: string } | undefined;
}) {
  const { models } = useConnected();
  const state = useReplicatedState(models.state);
  const providers = useProvidersDialog();
  const [open, setOpen] = useState(false);
  const available = state?.models ?? [];
  const current = available.find(
    (model) => model.provider === agent?.model?.provider && model.modelId === agent?.model?.modelId,
  );

  const report = (error: unknown): void => console.error(error);
  const choose = (model: ModelSummary): void => {
    setOpen(false);
    const ref = { provider: model.provider, modelId: model.modelId };
    conversation.configure({ model: ref }, BACKGROUND_CONTEXT).catch(report);
    // The last choice is what new conversations start with.
    models.setDefaultModel(ref, BACKGROUND_CONTEXT).catch(report);
  };

  if (available.length === 0) {
    return (
      <PromptInputButton onClick={() => providers.open()}>
        <KeyRoundIcon />
        Sign in to a model provider
      </PromptInputButton>
    );
  }

  const byProvider = groupByProvider(available, state?.providers ?? []);
  return (
    <>
      <ModelSelector open={open} onOpenChange={setOpen}>
        <ModelSelectorTrigger asChild>
          <PromptInputButton>
            <ModelSelectorName>
              {current?.name ??
                (agent?.model === undefined ? "Choose a model" : `${agent.model.modelId} (unavailable)`)}
            </ModelSelectorName>
            <ChevronDownIcon />
          </PromptInputButton>
        </ModelSelectorTrigger>
        <ModelSelectorContent title="Choose a model">
          <ModelSelectorInput placeholder="Search models" />
          <ModelSelectorList>
            <ModelSelectorEmpty>No model found.</ModelSelectorEmpty>
            {byProvider.map(({ name, models: group }) => (
              <ModelSelectorGroup key={name} heading={name}>
                {group.map((model) => (
                  <ModelSelectorItem
                    key={`${model.provider}/${model.modelId}`}
                    value={`${name} ${model.name} ${model.modelId}`}
                    onSelect={() => choose(model)}
                  >
                    <ModelSelectorName>{model.name}</ModelSelectorName>
                    {model === current && <CheckIcon />}
                  </ModelSelectorItem>
                ))}
              </ModelSelectorGroup>
            ))}
            <ModelSelectorSeparator />
            <ModelSelectorGroup>
              <ModelSelectorItem
                onSelect={() => {
                  setOpen(false);
                  providers.open();
                }}
              >
                <KeyRoundIcon />
                Model providers…
              </ModelSelectorItem>
            </ModelSelectorGroup>
          </ModelSelectorList>
        </ModelSelectorContent>
      </ModelSelector>
      {current !== undefined && current.thinkingLevels.length > 1 && (
        <PromptInputSelect
          value={agent?.thinkingLevel ?? "off"}
          onValueChange={(thinkingLevel) => conversation.configure({ thinkingLevel }, BACKGROUND_CONTEXT).catch(report)}
        >
          <PromptInputSelectTrigger aria-label="Thinking level">
            <PromptInputSelectValue />
          </PromptInputSelectTrigger>
          <PromptInputSelectContent>
            {current.thinkingLevels.map((level) => (
              <PromptInputSelectItem key={level} value={level}>
                {level === "off" ? "No thinking" : `Thinking: ${level}`}
              </PromptInputSelectItem>
            ))}
          </PromptInputSelectContent>
        </PromptInputSelect>
      )}
    </>
  );
}

function groupByProvider(
  models: ModelSummary[],
  providers: { id: string; name: string }[],
): { name: string; models: ModelSummary[] }[] {
  const groups = new Map<string, ModelSummary[]>();
  for (const model of models) groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
  return [...groups].map(([id, group]) => ({
    name: providers.find((provider) => provider.id === id)?.name ?? id,
    models: group,
  }));
}
