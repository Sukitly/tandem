// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AppSidebar } from "../src/app/sidebar.tsx";
import { SidebarProvider, useSidebar } from "../src/components/ui/sidebar.tsx";
import { renderInRouter } from "./in-router.tsx";

const state = vi.hoisted(() => ({ mobile: true }));
vi.mock("../src/hooks/use-mobile.ts", () => ({ useIsMobile: () => state.mobile }));
vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({
    workspaces: { state: { workspaces: [{ id: 1, name: "Project", path: "/project" }] } },
    conversations: {
      state: { conversations: [{ id: 2, workspaceId: 1, title: "Conversation", cwd: "/project", running: false }] },
    },
    terminals: { state: { terminals: [] } },
  }),
}));
vi.mock("../src/rpc/use-replicated-state.ts", () => ({ useReplicatedState: (value: unknown) => value }));
vi.mock("../src/app/workbench.tsx", () => ({ useWorkbench: () => ({ addProject: vi.fn(), removeProject: vi.fn() }) }));
vi.mock("../src/models/providers-dialog.tsx", () => ({ useProvidersDialog: () => ({ open: vi.fn() }) }));
afterEach(() => {
  cleanup();
  state.mobile = true;
});
function Probe() {
  const { openMobile, setOpenMobile } = useSidebar();
  return (
    <>
      <button type="button" onClick={() => setOpenMobile(true)}>
        Open navigation
      </button>
      <output data-testid="state">{String(openMobile)}</output>
    </>
  );
}
async function setup(path = "/c/2") {
  const view = await renderInRouter(
    <SidebarProvider>
      <Probe />
      <AppSidebar />
    </SidebarProvider>,
    { path },
  );
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  return view;
}
test.each([0, 1])(
  "closes after activating conversation entry %s, including the already selected conversation",
  async (index) => {
    await setup();
    const links = await screen.findAllByRole("link", { name: /Conversation/ });
    const link = links[index];
    expect(link?.getAttribute("href")).toBe("/c/2");
    if (link) fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("false"));
  },
);
test.each(["ctrlKey", "metaKey", "shiftKey", "altKey"])("preserves modified native navigation (%s)", async (key) => {
  const { router } = await setup("/");
  // What the page left of the click, seen on its way out of the document; the browser's own navigation is not run.
  let leftToBrowser: boolean | undefined;
  const stop = (event: Event): void => {
    leftToBrowser = !event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", stop);
  try {
    const link = (await screen.findAllByRole("link", { name: /Conversation/ }))[0];
    if (link) fireEvent.click(link, { [key]: true });
  } finally {
    document.removeEventListener("click", stop);
  }
  expect(leftToBrowser).toBe(true);
  expect(screen.getByTestId("state").textContent).toBe("true");
  expect(router.state.location.pathname).toBe("/");
});
test("closes after starting a conversation in a project, which opens the page for it", async () => {
  const { router } = await setup();
  const start = await screen.findByRole("link", { name: "New conversation in Project" });
  expect(start.getAttribute("href")).toBe("/p/1/new");
  fireEvent.click(start);
  expect(screen.getByTestId("state").textContent).toBe("false");
  await waitFor(() => expect(router.state.location.pathname).toBe("/p/1/new"));
});

test("a conversation's page is marked as the current one, and only that", async () => {
  await setup("/c/2");
  const [current] = await screen.findAllByRole("link", { name: /Conversation/ });
  expect(current?.getAttribute("aria-current")).toBe("page");
  cleanup();
  await setup("/");
  const [other] = await screen.findAllByRole("link", { name: /Conversation/ });
  expect(other?.getAttribute("aria-current")).toBeNull();
});
