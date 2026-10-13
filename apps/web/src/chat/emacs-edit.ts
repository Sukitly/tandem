export interface EmacsKey {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type EmacsEdit =
  | { kind: "move"; position: number }
  | { kind: "replace"; start: number; end: number; text: string; kill: boolean };

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const wordCharacter = /[\p{L}\p{N}_]/u;
const commands = new Set([
  "ctrl-a",
  "ctrl-e",
  "ctrl-b",
  "ctrl-f",
  "ctrl-p",
  "ctrl-n",
  "ctrl-d",
  "ctrl-h",
  "ctrl-k",
  "ctrl-u",
  "ctrl-w",
  "ctrl-y",
  "alt-b",
  "alt-f",
  "alt-d",
  "alt-backspace",
]);

/** Columns count graphemes, not UTF-16 code units, so vertical motion cannot land inside a character. */
export function emacsColumn(value: string, cursor: number): number {
  const start = cursor === 0 ? 0 : value.lastIndexOf("\n", cursor - 1) + 1;
  return [...graphemes.segment(value.slice(start, cursor))].length;
}

/** Plan an edit using textarea offsets; neither Meta shortcuts nor AltGr belong to the editor. */
export function emacsEdit(
  value: string,
  start: number,
  end: number,
  direction: string,
  key: EmacsKey,
  killed: string,
  goalColumn?: number,
): EmacsEdit | null {
  if (key.metaKey || key.shiftKey || key.ctrlKey === key.altKey) return null;
  // Option emits symbols on macOS (for example, Option+F is ƒ); recognize the physical word-editing keys too.
  const letter = key.altKey ? (key.code?.match(/^Key([BDF])$/)?.[1] ?? key.key) : key.key;
  const command = `${key.ctrlKey ? "ctrl" : "alt"}-${letter.toLowerCase()}`;
  if (!commands.has(command)) return null;
  const cursor = direction === "backward" ? start : end;
  const lineStart = cursor === 0 ? 0 : value.lastIndexOf("\n", cursor - 1) + 1;
  const newline = value.indexOf("\n", cursor);
  const lineEnd = newline < 0 ? value.length : newline;
  // Only character and word operations need the whole message's boundaries.
  let boundaries: number[] | undefined;
  let boundaryIndices: Map<number, number> | undefined;
  const characterBoundaries = (): { offsets: number[]; indices: Map<number, number> } => {
    if (boundaries === undefined || boundaryIndices === undefined) {
      boundaries = [...graphemes.segment(value)].map((segment) => segment.index);
      boundaries.push(value.length);
      boundaryIndices = new Map(boundaries.map((position, index) => [position, index]));
    }
    return { offsets: boundaries, indices: boundaryIndices };
  };
  const previous = (position: number): number => {
    const { offsets, indices } = characterBoundaries();
    const index = indices.get(position);
    return index === undefined ? (offsets.findLast((offset) => offset < position) ?? 0) : (offsets[index - 1] ?? 0);
  };
  const next = (position: number): number => {
    const { offsets, indices } = characterBoundaries();
    const index = indices.get(position);
    return index === undefined
      ? (offsets.find((offset) => offset > position) ?? value.length)
      : (offsets[index + 1] ?? value.length);
  };
  const atColumn = (start: number, end: number): number => {
    const column = goalColumn ?? emacsColumn(value, cursor);
    const line = [...graphemes.segment(value.slice(start, end))];
    return start + (line[column]?.index ?? end - start);
  };
  const wordBefore = (position: number): number => {
    let target = position;
    while (target > 0 && !wordCharacter.test(value.slice(previous(target), target))) target = previous(target);
    while (target > 0 && wordCharacter.test(value.slice(previous(target), target))) target = previous(target);
    return target;
  };
  const wordAfter = (position: number): number => {
    let target = position;
    while (target < value.length && !wordCharacter.test(value.slice(target, next(target)))) target = next(target);
    while (target < value.length && wordCharacter.test(value.slice(target, next(target)))) target = next(target);
    return target;
  };
  const move = (position: number): EmacsEdit => ({ kind: "move", position });
  const remove = (from: number, to: number, kill = false): EmacsEdit => ({
    kind: "replace",
    start: start === end ? from : start,
    end: start === end ? to : end,
    text: "",
    kill,
  });

  switch (command) {
    case "ctrl-a":
      return move(lineStart);
    case "ctrl-e":
      return move(lineEnd);
    case "ctrl-b":
      return move(start === end ? previous(cursor) : start);
    case "ctrl-f":
      return move(start === end ? next(cursor) : end);
    case "ctrl-p": {
      if (lineStart === 0) return move(0);
      const previousEnd = lineStart - 1;
      const previousStart = previousEnd === 0 ? 0 : value.lastIndexOf("\n", previousEnd - 1) + 1;
      return move(atColumn(previousStart, previousEnd));
    }
    case "ctrl-n": {
      if (lineEnd === value.length) return move(value.length);
      const nextStart = lineEnd + 1;
      const nextNewline = value.indexOf("\n", nextStart);
      return move(atColumn(nextStart, nextNewline < 0 ? value.length : nextNewline));
    }
    case "alt-b":
      return move(wordBefore(cursor));
    case "alt-f":
      return move(wordAfter(cursor));
    case "ctrl-d":
      return remove(cursor, next(cursor));
    case "ctrl-h":
      return remove(previous(cursor), cursor);
    case "ctrl-k":
      // At the end of a line, kill its newline so the next line joins it.
      return remove(cursor, cursor === lineEnd ? Math.min(cursor + 1, value.length) : lineEnd, true);
    case "ctrl-u":
      return remove(lineStart, cursor, true);
    case "ctrl-w": {
      let target = cursor;
      while (target > 0 && /\s/u.test(value.slice(previous(target), target))) target = previous(target);
      while (target > 0 && !/\s/u.test(value.slice(previous(target), target))) target = previous(target);
      return remove(target, cursor, true);
    }
    case "alt-d":
      return remove(cursor, wordAfter(cursor), true);
    case "alt-backspace":
      return remove(wordBefore(cursor), cursor, true);
    case "ctrl-y":
      return killed === "" ? move(cursor) : { kind: "replace", start, end, text: killed, kill: false };
    default:
      return null;
  }
}
