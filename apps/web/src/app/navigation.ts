import { createBrowserHistory, type RouterHistory } from "@tanstack/react-router";
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";

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

export const RouteContext = createContext<Route | null>(null);

export function useRoute(): Route {
  const matched = useContext(RouteContext);
  const hash = useLocationHash(matched === null);
  return useMemo(() => matched ?? parseRoute(hash), [matched, hash]);
}

let history: RouterHistory | undefined;

/** TanStack owns history. This adapter preserves existing #42 and #public-access bookmarks. */
export function navigationHistory(): RouterHistory {
  history ??= createBrowserHistory({
    parseLocation: () => {
      const pathname = `/${window.location.hash.slice(1)}`;
      return { href: pathname, pathname, search: "", hash: "", state: window.history.state ?? { __TSR_index: 0 } };
    },
    createHref: (path) =>
      `${window.location.pathname}${window.location.search}${path === "/" ? "" : `#${path.slice(1)}`}`,
  });
  return history;
}

export function subscribeNavigation(listener: () => void): () => void {
  return navigationHistory().subscribe(listener);
}

export function navigate(href: string): void {
  const target = new URL(href, window.location.href);
  if (target.origin !== window.location.origin) throw new Error("Application navigation must stay on this origin");
  const history = navigationHistory();
  const path = `/${target.hash.slice(1)}`;
  if (history.location.pathname !== path) history.push(path);
  history.flush();
}

const noSubscription = () => () => {};

export function useLocationHash(enabled = true): string {
  return useSyncExternalStore(
    enabled ? subscribeNavigation : noSubscription,
    () => {
      if (!enabled) return "";
      const path = navigationHistory().location.pathname;
      return path === "/" ? "" : `#${path.slice(1)}`;
    },
    () => "",
  );
}
