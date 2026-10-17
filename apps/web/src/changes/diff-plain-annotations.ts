/**
 * The only renderer-specific style compatibility layer, passed through CodeView's public unsafeCSS option.
 * No comment component reaches into or mutates a ShadowRoot. Keep these selectors covered by browser regressions
 * when upgrading @pierre/diffs: comments are plain, code remains selectable, and gutters permit touch scrolling.
 */
export const DIFF_COMMENT_CSS = `
[data-line-annotation], [data-gutter-buffer="annotation"] { --diffs-annotation-bg: var(--diffs-bg); }
[data-interactive-lines] [data-line] { cursor: text; }
[data-interactive-line-numbers] [data-column-number] { touch-action: pan-y pinch-zoom; }
`;
