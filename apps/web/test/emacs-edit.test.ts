import { describe, expect, test } from "vitest";
import { type EmacsKey, emacsColumn, emacsEdit } from "../src/chat/emacs-edit.ts";

const ctrl = (key: string): EmacsKey => ({ key, ctrlKey: true, altKey: false, metaKey: false, shiftKey: false });
const alt = (key: string): EmacsKey => ({ ...ctrl(key), ctrlKey: false, altKey: true });

function edit(value: string, position: number, key: EmacsKey, end = position, killed = "") {
  return emacsEdit(value, position, end, "none", key, killed);
}

describe("Emacs editing", () => {
  test.each([
    ["a", 7, 6],
    ["e", 7, 10],
    ["b", 7, 6],
    ["f", 7, 8],
    ["p", 8, 2],
    ["n", 2, 8],
    ["b", 0, 0],
    ["f", 10, 10],
    ["p", 2, 0],
    ["n", 8, 10],
  ])("Ctrl+%s moves from %i to %i", (key, position, target) => {
    expect(edit("first\nlast", position, ctrl(key))).toEqual({ kind: "move", position: target });
  });

  test("vertical movement clamps the column to the shorter line", () => {
    expect(edit("lengthy\nx\nlast", 5, ctrl("n"))).toEqual({ kind: "move", position: 9 });
    expect(edit("lengthy\nx\nlast", 13, ctrl("p"))).toEqual({ kind: "move", position: 9 });
  });

  test.each(["😀", "e\u0301", "👩‍💻"])("vertical columns count the grapheme %s once", (character) => {
    const value = `ab\n${character}z\nab`;
    expect(edit(value, 1, ctrl("n"))).toEqual({ kind: "move", position: 3 + character.length });
    expect(emacsColumn(value, 3 + character.length)).toBe(1);
    expect(edit(value, 3 + character.length, ctrl("p"))).toEqual({ kind: "move", position: 1 });
    expect(edit(value, 3 + character.length, ctrl("n"))).toEqual({ kind: "move", position: 6 + character.length });
  });

  test("an explicit goal column is restored after a short line", () => {
    expect(emacsEdit("abcdef\nx\nabcdef", 8, 8, "none", ctrl("n"), "", 5)).toEqual({ kind: "move", position: 14 });
  });

  test("empty lines and the start of a leading newline have correct boundaries", () => {
    expect(edit("\nlast", 0, ctrl("a"))).toEqual({ kind: "move", position: 0 });
    expect(edit("\nlast", 1, ctrl("p"))).toEqual({ kind: "move", position: 0 });
    expect(edit("first\n\nlast", 6, ctrl("e"))).toEqual({ kind: "move", position: 6 });
  });

  test.each([
    ["d", 2, 2, 3, false],
    ["h", 2, 1, 2, false],
    ["k", 2, 2, 5, true],
    ["k", 5, 5, 6, true],
    ["u", 8, 6, 8, true],
    ["w", 8, 6, 8, true],
    ["d", 10, 10, 10, false],
    ["h", 0, 0, 0, false],
  ])("Ctrl+%s at %i removes the expected range", (key, position, start, end, kill) => {
    expect(edit("first\nlast", position, ctrl(key))).toEqual({ kind: "replace", start, end, text: "", kill });
  });

  test("word movement skips punctuation and recognizes Unicode letters", () => {
    expect(edit("你好, café!", 4, alt("f"))).toEqual({ kind: "move", position: 8 });
    expect(edit("你好, café!", 9, alt("b"))).toEqual({ kind: "move", position: 4 });
    expect(edit("你好, café!", 3, alt("b"))).toEqual({ kind: "move", position: 0 });
  });

  test("macOS Option symbols still invoke word editing through their key codes", () => {
    expect(edit("hello world", 6, { ...alt("∫"), code: "KeyB" })).toEqual({ kind: "move", position: 0 });
    expect(edit("hello world", 6, { ...alt("ƒ"), code: "KeyF" })).toEqual({ kind: "move", position: 11 });
    expect(edit("hello world", 6, { ...alt("∂"), code: "KeyD" })).toEqual({
      kind: "replace",
      start: 6,
      end: 11,
      text: "",
      kill: true,
    });
  });

  test("word deletion distinguishes whitespace-delimited and punctuation-delimited words", () => {
    expect(edit("foo-bar  ", 9, ctrl("w"))).toEqual({ kind: "replace", start: 0, end: 9, text: "", kill: true });
    expect(edit("foo-bar  ", 9, alt("Backspace"))).toEqual({ kind: "replace", start: 4, end: 9, text: "", kill: true });
    expect(edit("foo-bar", 3, alt("d"))).toEqual({ kind: "replace", start: 3, end: 7, text: "", kill: true });
  });

  test.each(["😀", "e\u0301", "👩‍💻"])("movement and deletion preserve the grapheme %s", (grapheme) => {
    const value = `a${grapheme}b`;
    expect(edit(value, 1, ctrl("f"))).toEqual({ kind: "move", position: 1 + grapheme.length });
    expect(edit(value, 1 + grapheme.length, ctrl("b"))).toEqual({ kind: "move", position: 1 });
    expect(edit(value, 1, ctrl("d"))).toEqual({
      kind: "replace",
      start: 1,
      end: 1 + grapheme.length,
      text: "",
      kill: false,
    });
  });

  test("movement collapses a selection and deletion removes the selection", () => {
    expect(edit("hello", 1, ctrl("b"), 4)).toEqual({ kind: "move", position: 1 });
    expect(edit("hello", 1, ctrl("f"), 4)).toEqual({ kind: "move", position: 4 });
    expect(edit("hello", 1, ctrl("k"), 4)).toEqual({ kind: "replace", start: 1, end: 4, text: "", kill: true });
    expect(emacsEdit("first\nlast", 2, 8, "backward", ctrl("a"), "")).toEqual({ kind: "move", position: 0 });
  });

  test("yank replaces the selection, or does nothing when no text has been killed", () => {
    expect(edit("hello", 1, ctrl("y"), 4, "saved")).toEqual({
      kind: "replace",
      start: 1,
      end: 4,
      text: "saved",
      kill: false,
    });
    expect(edit("hello", 1, ctrl("y"))).toEqual({ kind: "move", position: 1 });
  });

  test.each([
    { ...ctrl("a"), ctrlKey: false },
    { ...ctrl("a"), altKey: true },
    { ...ctrl("a"), metaKey: true },
    { ...ctrl("a"), shiftKey: true },
    ctrl("c"),
    ctrl("v"),
    ctrl("x"),
    ctrl("z"),
    alt("Enter"),
  ])("leaves unsupported shortcuts to the browser: %o", (key) => {
    expect(edit("hello", 2, key)).toBeNull();
  });
});
