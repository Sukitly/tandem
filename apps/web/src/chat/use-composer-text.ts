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

/** Track text and selection without replacing native history; Emacs mode opts into a shared custom edit stack. */
export function useComposerText(onEdit: (value: string) => void, externalValue?: string, customHistory = false) {
  const initialValue = useRef(externalValue ?? "");
  const [value, setValue] = useState(initialValue.current);
  const [history] = useState(() => new TextHistory());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const current = useRef<TextSnapshot>({ value, start: value.length, end: value.length, direction: "none" });
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
    if (changed) notify.current(next.value);
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

  // A send may complete in another mounted composer, or while this view is absent. The draft owns that change.
  useLayoutEffect(() => {
    if (externalValue === undefined || externalValue === current.current.value) return;
    history.clear();
    composition.current = null;
    inputType.current = "";
    current.current = {
      value: externalValue,
      start: externalValue.length,
      end: externalValue.length,
      direction: "none",
    };
    pending.current = current.current;
    if (textareaRef.current !== null) textareaRef.current.value = externalValue;
    setValue(externalValue);
  }, [externalValue, history]);

  useLayoutEffect(() => {
    const next = pending.current;
    if (next === null) return;
    textareaRef.current?.setSelectionRange(next.start, next.end, next.direction);
    pending.current = null;
  });

  useEffect(() => {
    if (customHistory) history.clear();
  }, [history, customHistory]);

  // React's beforeinput abstraction does not expose every native history event. Listen to the textarea itself so
  // browser Edit-menu undo and keyboard undo use the same stack, including after programmatic edits.
  useEffect(() => {
    if (!customHistory) return;
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
  }, [customHistory]);

  const setText = (text: string, caret = text.length): void => {
    rememberSelection();
    const next: TextSnapshot = { value: text, start: caret, end: caret, direction: "none" };
    if (customHistory) history.record(current.current, next);
    apply(next);
  };

  const change = (textarea: HTMLTextAreaElement): void => {
    const next = snapshot(textarea);
    if (customHistory && composition.current === null)
      history.record(current.current, next, inputType.current === "insertText");
    inputType.current = "";
    // Native input already owns the caret. Touching its selection during composition can interrupt the IME.
    apply(next, false);
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!customHistory) return false;
    rememberSelection();
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) history.breakTyping();
    if (event.key.toLowerCase() !== "z" || !(event.ctrlKey || event.metaKey) || event.altKey) return false;
    event.preventDefault();
    restore(event.shiftKey);
    return true;
  };

  return {
    // Keep React from rewriting defaultValue on each native keystroke, which splits Chromium's undo groups.
    initialValue: initialValue.current,
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
      if (customHistory && before !== null) history.record(before, current.current);
    },
  };
}
