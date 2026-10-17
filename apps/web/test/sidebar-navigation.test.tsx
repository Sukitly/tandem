// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AppSidebar } from "../src/app/sidebar.tsx";
import { SidebarProvider, useSidebar } from "../src/components/ui/sidebar.tsx";

const state = vi.hoisted(() => ({ create: vi.fn(), mobile: true }));
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
vi.mock("../src/app/workbench.tsx", () => ({ useWorkbench: () => ({ selected: 2, newConversation: state.create }) }));
vi.mock("../src/models/providers-dialog.tsx", () => ({ useProvidersDialog: () => ({ open: vi.fn() }) }));
afterEach(() => {
  cleanup();
  state.create.mockClear();
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
function setup() {
  render(
    <SidebarProvider>
      <Probe />
      <AppSidebar />
    </SidebarProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
}
test.each([0, 1])(
  "closes after activating conversation entry %s, including the already selected conversation",
  async (index) => {
    setup();
    const links = await screen.findAllByRole("link", { name: /Conversation/ });
    const link = links[index];
    expect(link?.getAttribute("href")).toBe("#2");
    if (link) fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("false"));
  },
);
test.each(["ctrlKey", "metaKey", "shiftKey", "altKey"])("preserves modified native navigation (%s)", async (key) => {
  setup();
  const link = (await screen.findAllByRole("link", { name: /Conversation/ }))[0];
  if (link) fireEvent.click(link, { [key]: true });
  expect(screen.getByTestId("state").textContent).toBe("true");
});
test("closes after starting a conversation in a project", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "New conversation in Project" }));
  expect(state.create).toHaveBeenCalledWith(1);
  expect(screen.getByTestId("state").textContent).toBe("false");
});
