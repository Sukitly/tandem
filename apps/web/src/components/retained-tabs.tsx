import { type ReactNode, useEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
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

export function RetainedTab({
  value,
  visited,
  children,
}: {
  value: string;
  visited: ReadonlySet<string>;
  children: ReactNode;
}) {
  return (
    <TabsContent value={value} keepMounted className="flex min-h-0 flex-1 flex-col">
      {visited.has(value) ? children : null}
    </TabsContent>
  );
}
