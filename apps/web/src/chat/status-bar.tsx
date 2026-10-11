import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation, ModelRef, ModelSummary } from "@tandem/contracts";
import { CheckIcon, ChevronDownIcon, KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { useProvidersDialog } from "@/models/providers-dialog.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import type { ContextUsage } from "./transcript.ts";

export interface AgentChoice {
  model?: ModelRef;
  thinkingLevel?: string;
}

/** Under the message box: the model and thinking level, what the conversation cost, and how full its context is. */
export function StatusBar({
  conversation,
  agent,
  usage,
}: {
  conversation: Conversation;
  agent: AgentChoice | undefined;
  usage: ContextUsage;
}) {
  const { models } = useConnected();
  const state = useReplicatedState(models.state);
  const current = state?.models.find(
    (model) => model.provider === agent?.model?.provider && model.modelId === agent?.model?.modelId,
  );
  const contextWindow = current?.contextWindow ?? 0;
  const percent = contextWindow > 0 ? Math.min(100, (usage.tokens / contextWindow) * 100) : 0;
  const report = (error: unknown): void => console.error(error);

  return (
    <div className="grid gap-1.5">
      <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <ModelPicker conversation={conversation} agent={agent} current={current} />
        {current !== undefined && current.thinkingLevels.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="xs" />}>
              {thinkingLabel(agent?.thinkingLevel ?? "off")}
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Thinking</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={agent?.thinkingLevel ?? "off"}
                  onValueChange={(thinkingLevel: string) =>
                    conversation.configure({ thinkingLevel }, BACKGROUND_CONTEXT).catch(report)
                  }
                >
                  {current.thinkingLevels.map((level) => (
                    <DropdownMenuRadioItem key={level} value={level} closeOnClick>
                      {level === "off" ? "Off" : level[0]?.toUpperCase() + level.slice(1)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <span className="ml-auto shrink-0 font-mono tabular-nums">
          {formatCost(usage.cost)}
          {contextWindow > 0 && ` · ${percent.toFixed(0)}% of ${formatTokens(contextWindow)}`}
        </span>
      </div>
      {contextWindow > 0 && <Progress value={percent} aria-label="Context used" />}
    </div>
  );
}

function ModelPicker({
  conversation,
  agent,
  current,
}: {
  conversation: Conversation;
  agent: AgentChoice | undefined;
  current: ModelSummary | undefined;
}) {
  const { models } = useConnected();
  const state = useReplicatedState(models.state);
  const providers = useProvidersDialog();
  const [open, setOpen] = useState(false);
  const available = state?.models ?? [];
  const report = (error: unknown): void => console.error(error);

  if (available.length === 0) {
    return (
      <Button variant="ghost" size="xs" onClick={() => providers.open()}>
        <KeyRoundIcon />
        Sign in to a model provider
      </Button>
    );
  }

  const choose = (model: ModelSummary): void => {
    setOpen(false);
    const ref = { provider: model.provider, modelId: model.modelId };
    conversation.configure({ model: ref }, BACKGROUND_CONTEXT).catch(report);
    // The last choice is what new conversations start with.
    models.setDefaultModel(ref, BACKGROUND_CONTEXT).catch(report);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="xs" className="min-w-0" />}>
        <span className="truncate">
          {current?.name ?? (agent?.model === undefined ? "Choose a model" : `${agent.model.modelId} (unavailable)`)}
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

function thinkingLabel(level: string): string {
  return level === "off" ? "No thinking" : `Thinking: ${level}`;
}

function formatCost(dollars: number): string {
  return `$${dollars < 1 ? dollars.toFixed(3) : dollars.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  return `${Math.round(tokens / 1000)}K`;
}
