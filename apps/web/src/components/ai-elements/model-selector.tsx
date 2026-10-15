import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

export interface ModelSelectorProps {
  model?: string;
  models: ModelOption[];
  onModelChange: (modelId: string) => void;
  effort?: string;
  efforts?: Array<{ id: string; name: string }>;
  onEffortChange?: (effort: string) => void;
  onOpenSettings?: () => void;
}

/**
 * ModelSelector picks the model the agent runs and how hard it thinks.
 * Follows the shadcn/ui AI Elements Model Selector pattern.
 */
export function ModelSelector({
  model,
  models,
  onModelChange,
  effort,
  efforts,
  onEffortChange,
  onOpenSettings,
}: ModelSelectorProps) {
  const currentModel = models.find((m) => m.id === model) ?? models[0];
  const providers = Array.from(new Set(models.map((m) => m.provider)));

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Model: ${currentModel?.name ?? "Select model"}`}
              className="font-medium gap-1 text-xs"
            />
          }
        >
          <span>{currentModel?.name ?? "Select model"}</span>
          <ChevronDownIcon className="size-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {providers.length > 0 ? (
            <DropdownMenuRadioGroup value={model} onValueChange={onModelChange}>
              {providers.map((provider, index) => (
                <DropdownMenuGroup key={provider}>
                  {index > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {provider}
                  </DropdownMenuLabel>
                  {models
                    .filter((m) => m.provider === provider)
                    .map((item) => (
                      <DropdownMenuRadioItem key={item.id} value={item.id} closeOnClick>
                        {item.name}
                      </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuRadioGroup>
          ) : (
            <div className="p-2 text-xs text-muted-foreground">No models available</div>
          )}
          {onOpenSettings && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onOpenSettings}>Settings…</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {efforts !== undefined && efforts.length > 1 && onEffortChange !== undefined && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Effort: ${effort ?? "off"}`}
                className="gap-1 text-xs text-muted-foreground hover:text-foreground"
              />
            }
          >
            <span>{effort === "off" || effort === undefined ? "No thinking" : effort}</span>
            <ChevronDownIcon className="size-3 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Thinking Effort
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup value={effort ?? "off"} onValueChange={onEffortChange}>
                {efforts.map((item) => (
                  <DropdownMenuRadioItem key={item.id} value={item.id} closeOnClick>
                    {item.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
