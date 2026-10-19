import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ModelRef, ModelSummary } from "@tandem/contracts";
import { CheckIcon, ChevronDownIcon, KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.tsx";
import { useCommand } from "@/hooks/use-command.ts";
import { useProvidersDialog } from "@/models/providers-dialog.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";

export function ModelPicker({
  selectedModel,
  current,
  onConfigure,
}: {
  selectedModel: ModelRef | undefined;
  current: ModelSummary | undefined;
  onConfigure: (change: { model?: ModelRef }) => Promise<void>;
}) {
  const { models } = useConnected();
  const state = useReplicatedState(models.state);
  const providers = useProvidersDialog();
  const [open, setOpen] = useState(false);
  const save = useCommand({ failure: "Could not save model selection" });
  const { pending } = save;
  const available = state?.models ?? [];

  if (available.length === 0) {
    return (
      <Button variant="ghost" size="xs" onClick={() => providers.open()}>
        <KeyRoundIcon />
        Sign in to a model provider
      </Button>
    );
  }

  const choose = (model: ModelSummary): void => {
    if (pending) return;
    setOpen(false);
    const ref = { provider: model.provider, modelId: model.modelId };
    void save.run(async () => {
      await onConfigure({ model: ref });
      await models.setDefaultModel(ref, BACKGROUND_CONTEXT);
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="xs" disabled={pending} className="min-w-0 shrink text-left" />}
      >
        <span className="truncate">
          {current?.name ?? (selectedModel === undefined ? "Choose a model" : `${selectedModel.modelId} (unavailable)`)}
        </span>
        <ChevronDownIcon />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search models" />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            {groupByProvider(available, state?.providers ?? []).map(({ name, models: group }) => (
              <CommandGroup key={name} heading={name}>
                {group.map((model) => (
                  <CommandItem
                    key={`${model.provider}/${model.modelId}`}
                    value={`${name} ${model.name} ${model.modelId}`}
                    onSelect={() => choose(model)}
                  >
                    <span className="flex-1 truncate">{model.name}</span>
                    {model === current && <CheckIcon />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  providers.open();
                }}
              >
                <KeyRoundIcon />
                Model providers…
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
