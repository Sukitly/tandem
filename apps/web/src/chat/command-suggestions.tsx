import type { PromptTemplateSummary } from "@tandem/contracts";
import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/lib/utils.ts";
import type { CommandCompletion } from "./use-command-completion.ts";

export function CommandSuggestions({
  completion,
  onAccept,
}: {
  completion: CommandCompletion;
  onAccept(command: PromptTemplateSummary): void;
}) {
  const { open, query, listId, matching, optionId, selected, highlight } = completion;
  if (!open) return null;
  return (
    <div className="absolute bottom-full left-0 z-10 mb-2 w-full overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
      <p className="border-b px-2.5 py-1.5 text-xs text-muted-foreground">
        {query === "" ? "Commands" : `Commands matching /${query}`}
      </p>
      <div id={listId} role="listbox" aria-label="Commands" className="max-h-72 overflow-y-auto p-1">
        {matching.map((command, index) => (
          <button
            key={`${command.origin}/${command.name}`}
            id={optionId(index)}
            type="button"
            role="option"
            aria-selected={index === selected}
            tabIndex={-1}
            className={cn(
              "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden select-none",
              index === selected && "bg-muted text-foreground",
            )}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onAccept(command)}
            onMouseMove={() => {
              if (index !== selected) highlight(index);
            }}
          >
            <span className="shrink-0 font-mono">/{command.name}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{command.description}</span>
            <Badge variant="outline">{command.origin === "project" ? "Project" : "Global"}</Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
