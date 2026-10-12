import type { WorkspaceSummary } from "@tandem/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AppSidebar } from "../src/app/sidebar.tsx";
import { SidebarProvider } from "../src/components/ui/sidebar.tsx";

const state = vi.hoisted(() => ({
  workspaces: { workspaces: [] as WorkspaceSummary[] },
  conversations: { conversations: [] },
  terminals: { terminals: [] },
}));

vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({
    workspaces: { state: state.workspaces },
    conversations: { state: state.conversations },
    terminals: { state: state.terminals },
  }),
}));

vi.mock("../src/rpc/use-replicated-state.ts", () => ({
  useReplicatedState: (value: unknown) => value,
}));

vi.mock("../src/app/workbench.tsx", () => ({
  useWorkbench: () => ({
    selected: null,
    addProject: vi.fn(),
    newConversation: vi.fn(),
    removeProject: vi.fn(),
  }),
}));

vi.mock("../src/models/providers-dialog.tsx", () => ({
  useProvidersDialog: () => ({ open: vi.fn() }),
}));

function sidebar(): string {
  return renderToStaticMarkup(createElement(SidebarProvider, null, createElement(AppSidebar)));
}

beforeEach(() => {
  state.workspaces.workspaces = [];
});

describe("conversation creation in the sidebar", () => {
  test("has no global conversation action when no project exists", () => {
    expect(sidebar()).not.toContain("New conversation");
  });

  test("offers conversation creation only within each project", () => {
    state.workspaces.workspaces = [
      { id: 1, name: "First", path: "/projects/first" },
      { id: 2, name: "Second", path: "/projects/second" },
    ];
    const markup = sidebar();
    expect(markup).toContain('aria-label="New conversation in First"');
    expect(markup).toContain('aria-label="New conversation in Second"');
    expect(markup).not.toContain('title="New conversation"');
    expect(markup).not.toContain(">New conversation<");
  });
});
