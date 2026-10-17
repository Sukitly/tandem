// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { navigate } from "../src/app/navigation.ts";
import { useWorkbench, WorkbenchProvider } from "../src/app/workbench.tsx";
import { PublicAccessPageProvider, usePublicAccessPage } from "../src/tunnel/public-access.tsx";

vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({
    workspaces: {},
    files: {},
    comments: {},
    publicAccess: { state: {} },
    conversations: {
      state: {
        conversations: [
          { id: 41, workspaceId: 1 },
          { id: 42, workspaceId: 2 },
        ],
      },
    },
  }),
}));
vi.mock("../src/rpc/use-replicated-state.ts", () => ({ useReplicatedState: (state: unknown) => state }));
vi.mock("../src/app/add-project-dialog.tsx", () => ({ AddProjectDialog: () => null }));
vi.mock("../src/hooks/use-mobile.ts", () => ({ useIsMobile: () => false }));
vi.mock("../src/tunnel/setup-guide.tsx", () => ({ PublicAccessFlow: () => null }));
afterEach(cleanup);

function Probe() {
  const { selected, draft, newConversation } = useWorkbench();
  const publicAccess = usePublicAccessPage();
  return (
    <>
      <output data-testid="selection">{JSON.stringify({ selected, draft })}</output>
      <a href={publicAccess.href} onClick={publicAccess.onClick}>
        Manage public access
      </a>
      <button type="button" onClick={() => newConversation(2)}>
        New conversation
      </button>
    </>
  );
}
function setup() {
  window.history.replaceState(null, "", "/#41");
  render(
    <PublicAccessPageProvider>
      <WorkbenchProvider>
        <Probe />
      </WorkbenchProvider>
    </PublicAccessPageProvider>,
  );
}
function selection(selected: number | null, draft: number | null = null) {
  expect(screen.getByTestId("selection").textContent).toBe(JSON.stringify({ selected, draft }));
}

test("public access and browser traversal never desynchronize the selected conversation", async () => {
  setup();
  fireEvent.click(screen.getByRole("link", { name: "Manage public access" }));
  selection(41);
  expect(screen.getByRole("link", { name: "Back to workspace" }).getAttribute("href")).toBe("/#41");
  act(() => window.history.back());
  await waitFor(() => expect(window.location.hash).toBe("#41"));
  selection(41);
  act(() => navigate("/#42"));
  selection(42);
  act(() => window.history.back());
  await waitFor(() => selection(41));
  act(() => window.history.forward());
  await waitFor(() => selection(42));
});

test("returning from public access preserves the active new-conversation workspace", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
  selection(null, 2);
  fireEvent.click(screen.getByRole("link", { name: "Manage public access" }));
  selection(null, 2);
  fireEvent.click(screen.getByRole("link", { name: "Back to workspace" }));
  selection(null, 2);
  expect(window.location.hash).toBe("");
});
