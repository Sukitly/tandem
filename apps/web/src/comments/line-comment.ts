/**
 * A note on a line of a file, written while reviewing, waiting to be sent to the agent with the next message. It is
 * kept while the page is open and across reloads, because a review is not written in one sitting.
 */
export interface LineComment {
  id: string;
  /** The file's path from the project's directory. */
  path: string;
  /** 1-based, as the line was numbered when the comment was written. */
  line: number;
  /** Which side of a diff the line is on; absent for a comment on a file. */
  side?: "additions" | "deletions";
  /**
   * The line itself, as it was written. Line numbers move as the agent edits the file, so the text is what says which
   * code the note is about.
   */
  quote: string;
  text: string;
}

/** Where a comment is, as a person writes it: `src/app.ts:42`. */
export function commentPlace(comment: Pick<LineComment, "path" | "line">): string {
  return `${comment.path}:${comment.line}`;
}

/**
 * What the agent receives: each comment's place, the line it is about, and the note, then whatever else the user
 * typed. The place is a Markdown link to the file, so the transcript shows it as a link that opens the file at that
 * line, and the agent reads a path and a line number either way.
 */
export function commentMessage(comments: readonly LineComment[], text: string): string {
  const blocks = comments.map((comment) =>
    [
      `[${commentPlace(comment)}](${comment.path}#L${comment.line})`,
      ...quoteLines(comment.quote),
      ...noteLines(comment.text),
    ].join("\n"),
  );
  if (text.trim() !== "") blocks.push(text.trim());
  return blocks.join("\n\n");
}

function quoteLines(quote: string): string[] {
  const trimmed = quote.trim();
  return trimmed === "" ? [] : ["", `> ${trimmed}`];
}

function noteLines(text: string): string[] {
  const trimmed = text.trim();
  return trimmed === "" ? [] : ["", trimmed];
}
