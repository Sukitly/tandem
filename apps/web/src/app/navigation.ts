import { useMemo, useSyncExternalStore } from "react";

export type Route =
  | { kind: "conversation"; id: number }
  | { kind: "publicAccess" }
  | { kind: "none" }
  | { kind: "unknown"; hash: string };

/** Unknown pages must not clear the workbench selection or its new-conversation draft. */
export function parseRoute(hash: string): Route {
  if (hash === "" || hash === "#") return { kind: "none" };
  if (hash === "#public-access") return { kind: "publicAccess" };
  const text = hash.startsWith("#") ? hash.slice(1) : "";
  const id = Number(text);
  return text !== "" && Number.isSafeInteger(id) && id >= 0 ? { kind: "conversation", id } : { kind: "unknown", hash };
}

export function routeHash(route: Route): string {
  switch (route.kind) {
    case "conversation":
      return `#${route.id}`;
    case "publicAccess":
      return "#public-access";
    case "none":
      return "";
    case "unknown":
      return route.hash;
  }
}

export function useRoute(): Route {
  const hash = useLocationHash();
  return useMemo(() => parseRoute(hash), [hash]);
}

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
