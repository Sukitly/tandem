/**
 * The library paints a comment's row, and the number cell beside it, with a background of their own. A reviewed line is
 * plain, as it is in a code host: the box brings its own border instead.
 *
 * What the library sets lives inside the diff's shadow root, and nothing from outside reaches in, so the rule has to be
 * written there. A comment's own element is already in that root, which is where this is called from.
 */
const PLAIN_ROW = `[data-line-annotation], [data-n-buffer="annotation"] { --diffs-annotation-bg: var(--diffs-bg); }`;

const MARKER = "data-tandem-plain-row";

/** Make the row the given comment sits in plain. Does nothing outside a diff, where there is no such row. */
export function plainCommentRow(node: HTMLElement | null): void {
  const root = node?.getRootNode();
  if (!(root instanceof ShadowRoot)) return;
  if (root.querySelector(`[${MARKER}]`) !== null) return;
  const style = document.createElement("style");
  style.setAttribute(MARKER, "");
  style.textContent = PLAIN_ROW;
  root.append(style);
}
