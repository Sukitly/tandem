import {
  createBrowserHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ConversationPage, HomePage, NewConversationPage, NotFoundPage, PairPage } from "./pages.tsx";

export interface RouterContext {
  /** The pairing code the page was opened with, taken from its address before anything rendered. */
  pairCode: string | undefined;
}

/**
 * The pages and where they are. A browser's address is the one place that says which page is open and which
 * conversation or project it is about; nothing else keeps a copy.
 *
 * - What an address holds for an id is text, and the page that reads it decides whether it is an id: one that is not is
 *   a page that is not found, which only the page, inside the session, can say.
 * - `/pair` is outside the session: a device that is not paired yet has no connection to open one with.
 * - Everything else is in the session, which stays mounted from one page to the next. The workbench in it, with the
 *   panel's visited views, is also kept while the public access page is shown, only hidden.
 */
function routes(layout: () => ReactNode) {
  const root = createRootRouteWithContext<RouterContext>()({ component: Outlet, notFoundComponent: NotFoundPage });
  const pair = createRoute({ getParentRoute: () => root, path: "/pair", component: PairPage });
  const session = createRoute({
    getParentRoute: () => root,
    id: "session",
    component: layout,
    notFoundComponent: NotFoundPage,
  });
  const home = createRoute({ getParentRoute: () => session, path: "/", component: HomePage });
  const conversation = createRoute({
    getParentRoute: () => session,
    path: "/c/$conversationId",
    component: ConversationPage,
  });
  const newConversation = createRoute({
    getParentRoute: () => session,
    path: "/p/$workspaceId/new",
    component: NewConversationPage,
  });
  // The session shows this page itself, in place of the workbench it hides, so it has no component of its own.
  const publicAccess = createRoute({ getParentRoute: () => session, path: "/public-access" });
  const unknown = createRoute({ getParentRoute: () => session, path: "$", component: NotFoundPage });
  return root.addChildren([pair, session.addChildren([home, conversation, newConversation, publicAccess, unknown])]);
}

export function createAppRouter({
  history = createBrowserHistory(),
  pairCode,
  layout,
}: {
  history?: RouterHistory;
  pairCode?: string | undefined;
  /** What every page but `/pair` is inside, and where the page open is drawn, with an `Outlet`. */
  layout: () => ReactNode;
}) {
  return createRouter({
    routeTree: routes(layout),
    history,
    context: { pairCode },
    scrollRestoration: false,
    defaultHashScrollIntoView: false,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
