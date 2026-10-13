import { type ComponentProps, useEffect } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";

function conflictsWithEditing(event: KeyboardEvent): boolean {
  return event.key === "b" && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
}

/** Disable only the conflicting Ctrl+B binding without changing the generated sidebar component. */
export function AppSidebarProvider(props: ComponentProps<typeof SidebarProvider>) {
  useEffect(() => {
    const disableShortcut = (event: KeyboardEvent): void => {
      if (conflictsWithEditing(event)) event.stopPropagation();
    };
    // The generated provider has no shortcut opt-out. Bubble after editors, before its window listener, including
    // dialogs rendered outside the sidebar tree. Command and AltGr shortcuts are deliberately not intercepted.
    document.addEventListener("keydown", disableShortcut);
    return () => document.removeEventListener("keydown", disableShortcut);
  }, []);

  return <SidebarProvider {...props} />;
}
