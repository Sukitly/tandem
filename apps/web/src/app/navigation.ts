import { useSyncExternalStore } from "react";

const NAVIGATED = "tandem:navigated";

/** All application navigation, native history traversal, and ordinary hash links use the same notification path. */
export function subscribeNavigation(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATED, listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATED, listener);
  };
}

export function navigate(href: string): void {
  const target = new URL(href, window.location.href);
  if (target.origin !== window.location.origin) throw new Error("Application navigation must stay on this origin");
  if (target.href !== window.location.href) window.history.pushState(null, "", target);
  window.dispatchEvent(new Event(NAVIGATED));
}

export function useLocationHash(): string {
  return useSyncExternalStore(
    subscribeNavigation,
    () => window.location.hash,
    () => "",
  );
}
