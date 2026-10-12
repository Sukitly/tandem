/** A place in a file, as a Markdown link names it. */
export interface FileTarget {
  /** As written: from the project's directory, or absolute. */
  path: string;
  /** 1-based. */
  line?: number;
}

/**
 * The file a link points to, if it points to one: a path with no scheme and no query, and maybe a line, written as
 * GitHub does (`src/app.ts#L12`, `#L12-L20`) or as compilers do (`src/app.ts:12`, `src/app.ts:12:5`). A range opens
 * at its first line; any other fragment, such as a heading, opens the file at its top.
 */
export function parseFileLink(href: string): FileTarget | undefined {
  const hash = href.indexOf("#");
  let path = hash === -1 ? href : href.slice(0, hash);
  let line = hash === -1 ? undefined : /^L([1-9]\d*)(?:-L?\d+)?$/.exec(href.slice(hash + 1))?.[1];
  const suffix = /:([1-9]\d*)(?::\d+)?$/.exec(path);
  if (suffix !== null) {
    path = path.slice(0, suffix.index);
    line ??= suffix[1];
  }
  if (path === "" || path.includes("?") || path.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(path)) return undefined;
  try {
    path = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  return line === undefined ? { path } : { path, line: Number(line) };
}

/**
 * The path from the project's directory, for a path as a link wrote it; `undefined` when it is outside the project.
 * `..` is left to the server, which refuses it.
 */
export function projectPath(path: string, projectDirectory: string): string | undefined {
  if (!path.startsWith("/")) return path.replace(/^(\.\/)+/, "");
  const root = projectDirectory.endsWith("/") ? projectDirectory : `${projectDirectory}/`;
  if (path === projectDirectory || `${path}/` === root) return "";
  return path.startsWith(root) ? path.slice(root.length) : undefined;
}
