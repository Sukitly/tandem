import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ModelRef, ModelSummary } from "@tandem/contracts";
import { cn } from "cn";
import { CheckIcon, ChevronDownIcon, KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Context } from "@/components/ai-elements/context.tsx";
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
import { useProvidersDialog } from "@/models/providers-dialog.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
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
  const [pending, setPending] = useState(false);
  const contextWindow = current?.contextWindow ?? 0;
  const percent = contextWindow > 0 ? Math.min(100, (usage.tokens / contextWindow) * 100) : 0;
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
      <ModelPicker agent={agent} current={current} onConfigure={onConfigure} />
      {current !== undefined && current.thinkingLevels.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="shrink-0" disabled={pending} />}>
            <span className="hidden sm:inline">{thinkingLabel(agent?.thinkingLevel ?? "off")}</span>
            <span className="sm:hidden">{shortThinkingLabel(agent?.thinkingLevel ?? "off")}</span>
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Thinking</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={agent?.thinkingLevel ?? "off"} onValueChange={chooseThinking}>
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
      {contextWindow > 0 && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="hidden font-mono tabular-nums sm:inline">{formatCost(usage.cost)}</span>
          <Context
            usedTokens={usage.tokens}
            maxTokens={contextWindow}
            cost={usage.cost}
            label={
              <>
                <span>{percent.toFixed(0)}%</span>
                <span className="hidden sm:inline"> of {formatTokens(contextWindow)}</span>
              </>
            }
          />
        </div>
      )}
    </div>
  );
}

function ModelPicker({
  agent,
  current,
  onConfigure,
}: {
  agent: AgentChoice | undefined;
  current: ModelSummary | undefined;
  onConfigure: (change: AgentChoice) => Promise<void>;
}) {
  const { models } = useConnected();
  const state = useReplicatedState(models.state);
  const providers = useProvidersDialog();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const available = state?.models ?? [];
  const report = (error: unknown): void => {
    toast.error("Could not save model selection", {
      description: error instanceof Error ? error.message : String(error),
    });
  };

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
    setPending(true);
    setOpen(false);
    const ref = { provider: model.provider, modelId: model.modelId };
    Promise.resolve()
      .then(() => onConfigure({ model: ref }))
      .then(() => models.setDefaultModel(ref, BACKGROUND_CONTEXT))
      .catch(report)
      .finally(() => setPending(false));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            disabled={pending}
            className="shrink min-w-0 max-w-36 text-left sm:max-w-none"
          />
        }
      >
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

function shortThinkingLabel(level: string): string {
  return level === "off" ? "Off" : (level[0]?.toUpperCase() ?? "") + level.slice(1);
}

export function formatCost(dollars: number): string {
  return `$${dollars < 1 ? dollars.toFixed(3) : dollars.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  return `${Math.round(tokens / 1000)}K`;
}
