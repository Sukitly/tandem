import { useState } from "react";

/** A stable renderer item changes version only when one of its immutable payload inputs changes. */
export function useRenderVersion(deps: readonly unknown[]): number {
  const [previous, setPrevious] = useState(() => ({ deps, version: 0 }));
  if (previous.deps.length === deps.length && deps.every((value, index) => Object.is(value, previous.deps[index])))
    return previous.version;
  const version = previous.version + 1;
  setPrevious({ deps, version });
  return version;
}
