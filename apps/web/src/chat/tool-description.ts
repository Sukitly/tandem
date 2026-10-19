/** Argument context only; tool names are displayed verbatim from the conversation. */
export function toolDescription(args: Record<string, unknown>): string {
  if (typeof args.path === "string") {
    const offset = typeof args.offset === "number" ? args.offset : undefined;
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    const range =
      offset === undefined && limit === undefined
        ? ""
        : `:${offset ?? 1}${limit === undefined ? "" : `-${(offset ?? 1) + limit - 1}`}`;
    return `${args.path}${range}`;
  }
  if (typeof args.command === "string") return args.command;
  if (typeof args.threadId === "number" || typeof args.threadId === "string") return `#${args.threadId}`;
  return Object.keys(args).length === 0 ? "" : JSON.stringify(args);
}
