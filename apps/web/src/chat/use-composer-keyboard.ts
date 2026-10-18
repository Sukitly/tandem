import type { PromptTemplateSummary } from "@tandem/contracts";
import { type KeyboardEvent, useRef } from "react";
import { useCompositionGuard } from "@/hooks/use-composition-guard.ts";
import type { KeyboardMode, SendMode } from "./composer-options.tsx";
import { emacsColumn, emacsEdit } from "./emacs-edit.ts";
import { type CommandCompletion, completeCommand } from "./use-command-completion.ts";
import type { useComposerText } from "./use-composer-text.ts";

/** One owner for IME, undo, completion, Emacs editing and submission, in that precedence order. */
export function useComposerKeyboard({
  editor,
  keyboardMode,
  menu,
  send,
  sendMode,
  accept,
}: {
  editor: ReturnType<typeof useComposerText>;
  keyboardMode: KeyboardMode;
  menu: CommandCompletion;
  send(text: string, whenBusy: SendMode): Promise<void>;
  sendMode: SendMode;
  accept(command: PromptTemplateSummary): void;
}) {
  const { value } = editor;
  const { open: menuOpen, matching, selected } = menu;
  const composition = useCompositionGuard();
  const killedText = useRef("");
  const verticalGoal = useRef<{ column: number; position: number } | null>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (composition.owns(event)) return;
    if (event.getModifierState("AltGraph")) return;
    if (editor.keyDown(event)) {
      verticalGoal.current = null;
      return;
    }
    const emacsControl =
      keyboardMode === "emacs" && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;

    if (menuOpen) {
      if (event.key === "ArrowDown" || (emacsControl && event.key.toLowerCase() === "n")) {
        verticalGoal.current = null;
        event.preventDefault();
        menu.move(1);
        return;
      }
      if (event.key === "ArrowUp" || (emacsControl && event.key.toLowerCase() === "p")) {
        verticalGoal.current = null;
        event.preventDefault();
        menu.move(-1);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        // Tab fills the command into the box and closes the menu, so its arguments can be typed; Shift+Tab puts the
        // menu away, so the two never disagree.
        if (event.shiftKey) menu.dismiss();
        else {
          const command = matching[selected];
          if (command !== undefined) accept(command);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        menu.dismiss();
        return;
      }
      // Enter settles the highlighted command and sends it in one gesture, as pi's editor does for slash commands.
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const command = matching[selected];
        const message = command === undefined ? value : completeCommand(command);
        if (message !== value) editor.setText(message);
        void send(message, event.altKey ? "followUp" : sendMode);
        return;
      }
    }
    const textarea = event.currentTarget;
    const vertical = emacsControl && (event.key.toLowerCase() === "p" || event.key.toLowerCase() === "n");
    const cursor = textarea.selectionDirection === "backward" ? textarea.selectionStart : textarea.selectionEnd;
    const goal = verticalGoal.current;
    const column = vertical
      ? goal !== null && textarea.selectionStart === goal.position && textarea.selectionEnd === goal.position
        ? goal.column
        : emacsColumn(value, cursor)
      : undefined;
    const modifier = event.key === "Control" || event.key === "Alt" || event.key === "Meta" || event.key === "Shift";
    if (!vertical && !modifier) verticalGoal.current = null;
    const edit =
      keyboardMode === "emacs"
        ? emacsEdit(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
            textarea.selectionDirection,
            event,
            killedText.current,
            column,
          )
        : null;
    if (edit !== null) {
      event.preventDefault();
      if (edit.kind === "move") {
        textarea.setSelectionRange(edit.position, edit.position);
        if (column !== undefined) verticalGoal.current = { column, position: edit.position };
      } else if (edit.start !== edit.end || edit.text !== "") {
        if (edit.kill) killedText.current = textarea.value.slice(edit.start, edit.end);
        editor.setText(
          textarea.value.slice(0, edit.start) + edit.text + textarea.value.slice(edit.end),
          edit.start + edit.text.length,
        );
      }
      return;
    }
    // Ordinary characters and spaces, which close the menu by changing the message, and Shift+Enter's line break
    // remain the browser's.
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void send(value, event.altKey ? "followUp" : sendMode);
  };

  return {
    composition,
    onKeyDown,
    resetColumn: () => {
      verticalGoal.current = null;
    },
  };
}
