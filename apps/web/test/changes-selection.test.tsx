// @vitest-environment jsdom
import type { ChangesState, ProjectChanges } from "@tandem/contracts";
import { afterEach, expect, test, vi } from "vitest";
import { ChangesView } from "../src/changes/changes-view.tsx";
import type { ProjectComments } from "../src/comments/project-comments.ts";
import { SidebarProvider } from "../src/components/ui/sidebar.tsx";
import { cleanup, fireEvent, render, screen, waitFor } from "./render.tsx";

const mock = vi.hoisted(() => ({ state: undefined as ChangesState | undefined }));
vi.mock("../src/rpc/use-replicated-state.ts", () => ({ useReplicatedState: () => mock.state }));
vi.mock("../src/app/workbench.tsx", () => ({
  useWorkbench: () => ({ openFile: () => {}, forgetChangeTarget: () => {} }),
}));
vi.mock("../src/changes/change-diff.tsx", () => ({
  ChangeDiff: ({ path }: { path: string }) => <div data-testid="patch">{path}</div>,
}));
vi.mock("../src/hooks/use-mobile.ts", () => ({ useIsMobile: () => false }));
vi.mock("../src/components/ui/resizable.tsx", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => null,
}));
afterEach(cleanup);

test("selection survives service release and failed snapshots, but not authoritative deletion", async () => {
  const ready: ChangesState = {
    workspaceId: 1,
    status: "ready",
    files: [
      { path: "a.ts", status: "modified" },
      { path: "b.ts", status: "modified" },
    ],
  };
  mock.state = ready;
  const changes = { diff: vi.fn(async () => ({ kind: "patch", patch: "" })) } as unknown as ProjectChanges;
  const view = (service: ProjectChanges | undefined) => (
    <SidebarProvider>
      <ChangesView changes={service} failure={null} comments={{} as ProjectComments} />
    </SidebarProvider>
  );
  const rendered = render(view(changes));
  fireEvent.click(screen.getByText("b.ts"));
  await waitFor(() => expect(screen.getByTestId("patch").textContent).toBe("b.ts"));
  mock.state = undefined;
  rendered.rerender(view(undefined));
  mock.state = { ...ready, status: "error", files: [] };
  rendered.rerender(view(changes));
  mock.state = ready;
  rendered.rerender(view(changes));
  await waitFor(() => expect(screen.getByTestId("patch").textContent).toBe("b.ts"));
  mock.state = { ...ready, files: ready.files.filter((file) => file.path === "a.ts") };
  rendered.rerender(view(changes));
  expect(screen.queryByTestId("patch")).toBeNull();
});
