/**
 * The language to highlight a file in, from its name: its extension (`ts`, `yml`), or the whole name for files with
 * none, such as `Dockerfile` and `Makefile`. The highlighter knows which of these it has a grammar for.
 */
export function languageOfFile(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot > 0 ? lower.slice(dot + 1) : lower;
}
