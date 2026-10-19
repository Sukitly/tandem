import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { createAppRouter } from "../src/app/router.tsx";

/**
 * Renders `ui` as the session of the real router, at `path`, so that links, navigation, and the address a component
 * reads are the real ones. The pages are not drawn: only `ui` is, which is what a test of one component wants.
 */
export async function renderInRouter(
  ui: ReactElement,
  { path = "/", pairCode }: { path?: string; pairCode?: string } = {},
) {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter({ history, pairCode, layout: () => ui });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  return { ...view, router, history };
}
