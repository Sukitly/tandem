import type { PromptTemplateSummary } from "@tandem/contracts";
import { useEffect, useId, useRef, useState } from "react";

/** Combobox navigation is separate from text editing: accepting a command never takes focus from the input. */
export function useCommandCompletion(value: string, commands: readonly PromptTemplateSummary[], sending: boolean) {
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const query = /^\/([^\s/]*)$/.exec(value)?.[1] ?? null;
  const matching =
    query === null ? [] : commands.filter((command) => command.name.toLowerCase().startsWith(query.toLowerCase()));
  const open = query !== null && !dismissed && matching.length > 0 && !sending;
  const selected = open ? Math.min(highlight, matching.length - 1) : -1;
  useEffect(() => {
    if (selected >= 0) document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [listId, selected]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !boxRef.current?.contains(event.target)) setDismissed(true);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);
  return {
    boxRef,
    listId,
    query,
    matching,
    open,
    selected,
    optionId: (index: number) => `${listId}-${index}`,
    highlight: setHighlight,
    dismiss: () => setDismissed(true),
    reset: () => {
      setHighlight(0);
      setDismissed(false);
    },
    move: (offset: number) => setHighlight((current) => (current + offset + matching.length) % matching.length),
  };
}
export type CommandCompletion = ReturnType<typeof useCommandCompletion>;
export function completeCommand(command: PromptTemplateSummary): string {
  return `/${command.name} `;
}
