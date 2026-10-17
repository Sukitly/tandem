// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ChatComposer } from "../src/chat/chat-composer.tsx";

vi.mock("../src/app/workbench.tsx", () => ({
  useWorkbench: () => ({ openChange: vi.fn() }),
}));

Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
  localStorage.removeItem("tandem.keyboardMode");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function composer() {
  localStorage.setItem("tandem.keyboardMode", "emacs");
  const onSend = vi.fn().mockResolvedValue(undefined);
  render(
    createElement(ChatComposer, {
      busy: false,
      queued: [],
      commands: [
        { name: "review", description: "Review changes", origin: "project" },
        { name: "commit", description: "Commit changes", origin: "project" },
      ],
      imageSupport: { kind: "none" },
      onSend,
      onStop: vi.fn(),
    }),
  );
  return { textarea: screen.getByLabelText("Message") as HTMLTextAreaElement, onSend };
}

function type(textarea: HTMLTextAreaElement, value: string, position = value.length): void {
  fireEvent.change(textarea, { target: { value } });
  textarea.setSelectionRange(position, position);
}

function press(textarea: HTMLTextAreaElement, key: string, init: KeyboardEventInit = {}): boolean {
  return !fireEvent.keyDown(textarea, { key, ctrlKey: true, ...init });
}

describe("chat composer Emacs keys", () => {
  test("edits controlled text and restores the caret before continuing to type or send", async () => {
    const { textarea, onSend } = composer();
    type(textarea, "hello world", 5);
    expect(press(textarea, "k")).toBe(true);
    expect(textarea.value).toBe("hello");
    expect(textarea.selectionStart).toBe(5);
    expect(press(textarea, "a")).toBe(true);
    expect(textarea.selectionStart).toBe(0);
    expect(press(textarea, "y")).toBe(true);
    expect(textarea.value).toBe(" worldhello");
    expect(textarea.selectionStart).toBe(6);
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith(" worldhello", [], [], "steer");
    await waitFor(() => expect(textarea.value).toBe(""));
    press(textarea, "z");
    expect(textarea.value).toBe("");
  });

  test("ordinary deletion and an empty kill do not discard the last killed text", () => {
    const { textarea } = composer();
    type(textarea, "hello world", 5);
    press(textarea, "k");
    press(textarea, "k");
    press(textarea, "h");
    press(textarea, "y");
    expect(textarea.value).toBe("hell world");
    expect(textarea.selectionStart).toBe(10);
  });

  test.each([{ ctrlKey: true }, { ctrlKey: false, metaKey: true }])(
    "undo and redo restore programmatic edits and their selections: %o",
    (modifiers) => {
      const { textarea } = composer();
      type(textarea, "hello world");
      textarea.setSelectionRange(1, 5, "backward");
      press(textarea, "k");
      expect(textarea.value).toBe("h world");
      expect(press(textarea, "z", modifiers)).toBe(true);
      expect(textarea.value).toBe("hello world");
      expect([textarea.selectionStart, textarea.selectionEnd, textarea.selectionDirection]).toEqual([1, 5, "backward"]);
      press(textarea, "z", { ...modifiers, shiftKey: true });
      expect(textarea.value).toBe("h world");
      expect(textarea.selectionStart).toBe(1);
    },
  );

  test("native input and Emacs edits share one undo stack, and a new edit discards redo", () => {
    const { textarea } = composer();
    type(textarea, "hello world", 5);
    press(textarea, "k");
    press(textarea, "z");
    expect(textarea.value).toBe("hello world");
    press(textarea, "z");
    expect(textarea.value).toBe("");
    press(textarea, "z", { shiftKey: true });
    expect(textarea.value).toBe("hello world");
    press(textarea, "h");
    expect(textarea.value).toBe("hell world");
    press(textarea, "z", { shiftKey: true });
    expect(textarea.value).toBe("hell world");
  });

  test("native beforeinput history events use the same undo and redo stack", () => {
    const { textarea } = composer();
    type(textarea, "hello world", 5);
    press(textarea, "k");
    for (const [inputType, expected] of [
      ["historyUndo", "hello world"],
      ["historyRedo", "hello"],
    ]) {
      const event = new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true });
      expect(fireEvent(textarea, event)).toBe(false);
      expect(textarea.value).toBe(expected);
    }
  });

  test("native typing is grouped and paste starts a separate undo step", () => {
    const { textarea } = composer();
    for (const value of ["h", "hi"]) {
      fireEvent(textarea, new InputEvent("beforeinput", { inputType: "insertText", bubbles: true, cancelable: true }));
      fireEvent.change(textarea, { target: { value } });
    }
    fireEvent(
      textarea,
      new InputEvent("beforeinput", { inputType: "insertFromPaste", bubbles: true, cancelable: true }),
    );
    fireEvent.change(textarea, { target: { value: "hi there" } });
    press(textarea, "z");
    expect(textarea.value).toBe("hi");
    press(textarea, "z");
    expect(textarea.value).toBe("");
  });

  test("command completion can be undone without leaving the command menu out of date", () => {
    const { textarea } = composer();
    type(textarea, "/");
    fireEvent.keyDown(textarea, { key: "Tab" });
    expect(textarea.value).toBe("/review ");
    press(textarea, "z");
    expect(textarea.value).toBe("/");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  test("a failed send preserves both the message and its editing history", async () => {
    const { textarea, onSend } = composer();
    onSend.mockRejectedValueOnce(new Error("Send failed"));
    type(textarea, "hello world", 5);
    press(textarea, "k");
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Send failed"));
    expect(textarea.value).toBe("hello");
    press(textarea, "z");
    expect(textarea.value).toBe("hello world");
  });

  test("an IME composition is undone as one edit", () => {
    vi.useFakeTimers();
    const { textarea } = composer();
    const selection = vi.spyOn(textarea, "setSelectionRange");
    fireEvent.compositionStart(textarea);
    for (const value of ["n", "ni", "你"]) fireEvent.change(textarea, { target: { value } });
    fireEvent.compositionEnd(textarea);
    expect(selection).not.toHaveBeenCalled();
    vi.advanceTimersByTime(11);
    press(textarea, "z");
    expect(textarea.value).toBe("");
    press(textarea, "z", { shiftKey: true });
    expect(textarea.value).toBe("你");
  });

  test("vertical motion preserves its goal column through short lines in either direction", () => {
    const { textarea } = composer();
    type(textarea, "abcdef\nx\nabcdef", 5);
    press(textarea, "n");
    expect(textarea.selectionStart).toBe(8);
    fireEvent.keyDown(textarea, { key: "Control", ctrlKey: true });
    press(textarea, "n");
    expect(textarea.selectionStart).toBe(14);
    press(textarea, "p");
    expect(textarea.selectionStart).toBe(8);
    press(textarea, "p");
    expect(textarea.selectionStart).toBe(5);
  });

  test.each(["😀", "e\u0301", "👩‍💻"])("vertical motion and subsequent deletion preserve %s", (character) => {
    const { textarea } = composer();
    type(textarea, `ab\n${character}z`, 1);
    press(textarea, "n");
    expect(textarea.selectionStart).toBe(3 + character.length);
    press(textarea, "h");
    expect(textarea.value).toBe("ab\nz");
    expect(textarea.value.isWellFormed()).toBe(true);
  });

  test("pointer and horizontal movement start a new vertical goal", () => {
    const { textarea } = composer();
    type(textarea, "abcdef\nx\nabcdef", 5);
    press(textarea, "n");
    press(textarea, "b");
    press(textarea, "n");
    expect(textarea.selectionStart).toBe(9);
    textarea.setSelectionRange(5, 5);
    press(textarea, "n");
    fireEvent.pointerDown(textarea);
    press(textarea, "n");
    expect(textarea.selectionStart).toBe(10);
  });

  test("Ctrl+N/P select slash commands and return to editing after dismissal", () => {
    const { textarea } = composer();
    type(textarea, "/");
    press(textarea, "n");
    const selected = () => document.getElementById(textarea.getAttribute("aria-activedescendant") ?? "");
    expect(selected()?.textContent).toContain("/commit");
    press(textarea, "n");
    expect(selected()?.textContent).toContain("/review");
    press(textarea, "p");
    expect(selected()?.textContent).toContain("/commit");
    fireEvent.keyDown(textarea, { key: "Escape" });
    press(textarea, "p");
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.value).toBe("/");
  });

  test("Emacs edits update command suggestions just like ordinary typing", () => {
    const { textarea } = composer();
    type(textarea, "/r");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    press(textarea, "h");
    expect(textarea.value).toBe("/");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  test("leaves IME-owned keys and the Safari composition settling interval alone", () => {
    vi.useFakeTimers();
    const { textarea, onSend } = composer();
    type(textarea, "hello");
    expect(press(textarea, "a", { isComposing: true })).toBe(false);
    expect(press(textarea, "a", { keyCode: 229 })).toBe(false);
    fireEvent.compositionStart(textarea);
    expect(press(textarea, "k")).toBe(false);
    fireEvent.compositionEnd(textarea);
    expect(press(textarea, "a")).toBe(false);
    expect(press(textarea, "Enter", { ctrlKey: false })).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(11);
    expect(press(textarea, "a")).toBe(true);
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.value).toBe("hello");
  });

  test("does not capture ordinary typing, Meta shortcuts, AltGr, or Shift+Enter", () => {
    const { textarea } = composer();
    type(textarea, "hello");
    expect(press(textarea, "a", { ctrlKey: false })).toBe(false);
    expect(press(textarea, "a", { ctrlKey: false, metaKey: true })).toBe(false);
    expect(press(textarea, "a", { altKey: true })).toBe(false);
    expect(press(textarea, "Enter", { ctrlKey: false, shiftKey: true })).toBe(false);
    expect(textarea.value).toBe("hello");
  });

  test("Alt+Enter still queues a follow-up", async () => {
    const { textarea, onSend } = composer();
    type(textarea, "hello");
    press(textarea, "Enter", { ctrlKey: false, altKey: true });
    expect(onSend).toHaveBeenCalledWith("hello", [], [], "followUp");
    await waitFor(() => expect(textarea.value).toBe(""));
  });
});
