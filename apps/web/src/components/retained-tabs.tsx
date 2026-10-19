import { type ReactNode, useEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { ErrorBoundary } from "./error-boundary.tsx";
import { TabsContent } from "./ui/tabs.tsx";

/** Only committed, visible visits acquire resources. Hidden tabs retain their DOM but do not create new views. */
export function useVisitedTabs(value: string, active: boolean): ReadonlySet<string> {
  const [store] = useState(() => createStore<ReadonlySet<string>>(() => new Set(active ? [value] : [])));
  const visited = useStore(store);
  useEffect(() => {
    if (active && !store.getState().has(value)) store.setState(new Set([...store.getState(), value]), true);
  }, [store, value, active]);
  return visited;
}

/** A tab that keeps its view while another shows, and whose view failing to draw leaves the other tabs as they were. */
export function RetainedTab({
  value,
  label,
  visited,
  children,
}: {
  value: string;
  /** What the tab is called, to say which one failed. */
  label: string;
  visited: ReadonlySet<string>;
  children: ReactNode;
}) {
  return (
    <TabsContent value={value} keepMounted className="flex min-h-0 flex-1 flex-col">
      {visited.has(value) ? <ErrorBoundary what={`the ${label} tab`}>{children}</ErrorBoundary> : null}
    </TabsContent>
  );
}
