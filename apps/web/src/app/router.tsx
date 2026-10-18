import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { navigationHistory, parseRoute, type Route, RouteContext } from "./navigation.ts";

const NONE: Route = { kind: "none" };

/** Route matching changes navigation intent, not resource ownership. The session shell never remounts. */
const root = createRootRouteWithContext<{ shell: ReactNode; destination: Route }>()({
  component: function ApplicationRoute() {
    const { shell } = root.useRouteContext();
    const destination = useRouterState({ select: (state): Route => state.matches.at(-1)?.context.destination ?? NONE });
    return <RouteContext.Provider value={destination}>{shell}</RouteContext.Provider>;
  },
  notFoundComponent: () => null,
});
const index = createRoute({
  getParentRoute: () => root,
  path: "/",
  beforeLoad: () => ({ destination: NONE }),
});
const publicAccess = createRoute({
  getParentRoute: () => root,
  path: "/public-access",
  beforeLoad: () => ({ destination: { kind: "publicAccess" } as Route }),
});
const conversation = createRoute({
  getParentRoute: () => root,
  path: "/$conversationId",
  beforeLoad: ({ params }) => ({ destination: parseRoute(`#${params.conversationId}`) }),
});
const unknown = createRoute({
  getParentRoute: () => root,
  path: "$",
  beforeLoad: ({ location }) => ({ destination: { kind: "unknown", hash: `#${location.pathname.slice(1)}` } as Route }),
});
const routeTree = root.addChildren([index, publicAccess, conversation, unknown]);

export function ApplicationRouter({ children }: { children: ReactNode }) {
  const [router] = useState(() =>
    createRouter({
      routeTree,
      history: navigationHistory(),
      context: { shell: children, destination: NONE },
      scrollRestoration: false,
      defaultHashScrollIntoView: false,
    }),
  );
  return <RouterProvider router={router} context={{ shell: children, destination: NONE }} />;
}
