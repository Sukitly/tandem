import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TextHistory, type TextSnapshot } from "./text-history.ts";

const emptySnapshot = (): TextSnapshot => ({ value: "", start: 0, end: 0, direction: "none" });

function snapshot(textarea: HTMLTextAreaElement): TextSnapshot {
  return {
    value: textarea.value,
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
    direction: textarea.selectionDirection,
  };
}

/** Native typing, command completion, and Emacs edits share one history and restore both text and selection. */
export function useComposerText(onEdit: () => void) {
  const [value, setValue] = useState("");
  const [history] = useState(() => new TextHistory());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const current = useRef(emptySnapshot());
  const pending = useRef<TextSnapshot | null>(null);
  const composition = useRef<TextSnapshot | null>(null);
  const inputType = useRef("");
  const notify = useRef(onEdit);
  notify.current = onEdit;

  const rememberSelection = (): void => {
    const textarea = textareaRef.current;
    if (textarea === null || textarea.value !== current.current.value) return;
    const selected = snapshot(textarea);
    if (selected.start !== current.current.start || selected.end !== current.current.end) history.breakTyping();
    current.current = selected;
  };

  const apply = (next: TextSnapshot, restoreSelection = true): void => {
    const changed = next.value !== current.current.value;
    current.current = next;
    const textarea = textareaRef.current;
    if (textarea !== null && restoreSelection) {
      if (textarea.value !== next.value) textarea.value = next.value;
      textarea.setSelectionRange(next.start, next.end, next.direction);
    }
    pending.current = changed && restoreSelection ? next : null;
    setValue(next.value);
    if (changed) notify.current();
  };

  const restore = (redo: boolean): void => {
    rememberSelection();
    const next = redo ? history.redo(current.current) : history.undo(current.current);
    if (next !== null) apply(next);
  };
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const rememberRef = useRef(rememberSelection);
  rememberRef.current = rememberSelection;

  useLayoutEffect(() => {
    const next = pending.current;
    if (next === null) return;
    textareaRef.current?.setSelectionRange(next.start, next.end, next.direction);
    pending.current = null;
  });

  // React's beforeinput abstraction does not expose every native history event. Listen to the textarea itself so
  // browser Edit-menu undo and keyboard undo use the same stack, including after programmatic edits.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    const beforeInput = (event: InputEvent): void => {
      rememberRef.current();
      inputType.current = event.inputType;
      if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") return;
      if (!event.cancelable || composition.current !== null) return;
      event.preventDefault();
      restoreRef.current(event.inputType === "historyRedo");
    };
    textarea.addEventListener("beforeinput", beforeInput);
    return () => textarea.removeEventListener("beforeinput", beforeInput);
  }, []);

  const setText = (text: string, caret = text.length): void => {
    rememberSelection();
    const next: TextSnapshot = { value: text, start: caret, end: caret, direction: "none" };
    history.record(current.current, next);
    apply(next);
  };

  const change = (textarea: HTMLTextAreaElement): void => {
    const next = snapshot(textarea);
    if (composition.current === null) history.record(current.current, next, inputType.current === "insertText");
    inputType.current = "";
    // Native input already owns the caret. Touching its selection during composition can interrupt the IME.
    apply(next, false);
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    rememberSelection();
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) history.breakTyping();
    if (event.key.toLowerCase() !== "z" || !(event.ctrlKey || event.metaKey) || event.altKey) return false;
    event.preventDefault();
    restore(event.shiftKey);
    return true;
  };

  return {
    value,
    textareaRef,
    setText,
    change,
    keyDown,
    rememberSelection,
    reset: () => {
      history.clear();
      composition.current = null;
      inputType.current = "";
      apply(emptySnapshot());
    },
    compositionStart: () => {
      rememberSelection();
      history.breakTyping();
      composition.current = current.current;
    },
    compositionEnd: (textarea: HTMLTextAreaElement) => {
      change(textarea);
      const before = composition.current;
      composition.current = null;
      if (before !== null) history.record(before, current.current);
    },
  };
}
