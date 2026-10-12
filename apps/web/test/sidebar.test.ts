import type { ConversationSummary, WorkspaceSummary } from "@tandem/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AppSidebar } from "../src/app/sidebar.tsx";
import { SidebarProvider } from "../src/components/ui/sidebar.tsx";

const state = vi.hoisted(() => ({
  selected: null as number | null,
  workspaces: { workspaces: [] as WorkspaceSummary[] },
  conversations: { conversations: [] as ConversationSummary[] },
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
    selected: state.selected,
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
  state.selected = null;
  state.workspaces.workspaces = [];
  state.conversations.conversations = [];
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

describe("project row actions", () => {
  beforeEach(() => {
    state.workspaces.workspaces = [{ id: 1, name: "First", path: "/projects/first" }];
    state.conversations.conversations = [
      {
        id: 10,
        workspaceId: 1,
        cwd: "/projects/first",
        createdAt: 0,
        updatedAt: 0,
        title: "Existing conversation",
        running: false,
      },
    ];
  });

  test("limits the action hover group to the project header, excluding conversations", () => {
    const markup = sidebar();
    const row = markup.match(/<div class="group\/project-row relative">([\s\S]*?)<\/div>/)?.[1];
    expect(row).toBeDefined();
    expect(row).toContain('aria-label="New conversation in First"');
    expect(row).toContain('aria-label="More for First"');
    expect(row).not.toContain("Existing conversation");
    expect(markup).toContain("Existing conversation");
  });

  test("uses row hover and focus at every width while keeping touch and expanded actions visible", () => {
    const actions = (sidebar().match(/<button\b[^>]*>/g) ?? []).filter(
      (button) =>
        button.includes('aria-label="New conversation in First"') || button.includes('aria-label="More for First"'),
    );
    expect(actions).toHaveLength(2);
    for (const action of actions) {
      expect(action).toContain("opacity-0");
      expect(action).toContain("group-hover/project-row:opacity-100");
      expect(action).toContain("group-focus-within/project-row:opacity-100");
      expect(action).toContain("aria-expanded:opacity-100");
      expect(action).toContain("[@media(hover:none)]:opacity-100");
      expect(action).not.toContain("md:opacity-0");
      expect(action).not.toContain("group-hover/menu-item:opacity-100");
      expect(action).not.toContain("group-focus-within/menu-item:opacity-100");
    }
  });
});

function conversationRows(markup: string, id: number): string[] {
  return (markup.match(/<a\b[^>]*>/g) ?? []).filter((link) => link.includes(`href="#${id}"`));
}

function rowClasses(row: string): string[] {
  return row.match(/class="([^"]*)"/)?.[1]?.split(" ") ?? [];
}

describe("the current conversation background", () => {
  beforeEach(() => {
    state.workspaces.workspaces = [{ id: 1, name: "First", path: "/projects/first" }];
    state.conversations.conversations = [10, 11].map((id) => ({
      id,
      workspaceId: 1,
      cwd: "/projects/first",
      createdAt: 0,
      updatedAt: 0,
      title: `Conversation ${id}`,
      running: false,
    }));
  });

  test("keeps the workspace hover background on the current conversation in both lists", () => {
    state.selected = 10;
    const markup = sidebar();
    const currentRows = conversationRows(markup, 10);
    expect(currentRows).toHaveLength(2);
    for (const row of currentRows) {
      expect(rowClasses(row)).toContain("bg-sidebar-accent");
      expect(row).toContain('aria-current="page"');
    }
    for (const row of conversationRows(markup, 11)) {
      expect(rowClasses(row)).not.toContain("bg-sidebar-accent");
      expect(row).not.toContain("aria-current");
    }
    const projectButton = (markup.match(/<button\b[^>]*>/g) ?? []).find((button) =>
      button.includes('title="/projects/first"'),
    );
    expect(projectButton).toBeDefined();
    expect(rowClasses(projectButton ?? "")).toContain("hover:bg-sidebar-accent");
    expect(rowClasses(projectButton ?? "")).not.toContain("bg-sidebar-accent");
  });

  test("aligns conversation backgrounds with the project row's right edge while keeping left indentation", () => {
    const list = (sidebar().match(/<ul\b[^>]*>/g) ?? []).find((tag) => tag.includes('data-slot="sidebar-menu-sub"'));
    expect(list).toBeDefined();
    const classes = rowClasses(list ?? "");
    expect(classes).toContain("mr-0");
    expect(classes).toContain("pr-0");
    expect(classes).toContain("mx-3.5");
    expect(classes).toContain("px-2.5");
  });

  test("moves the persistent background in both lists when the current conversation changes", () => {
    state.selected = 10;
    expect(conversationRows(sidebar(), 10).every((row) => rowClasses(row).includes("bg-sidebar-accent"))).toBe(true);
    state.selected = 11;
    const markup = sidebar();
    for (const row of conversationRows(markup, 10)) {
      expect(rowClasses(row)).not.toContain("bg-sidebar-accent");
      expect(row).not.toContain("aria-current");
    }
    for (const row of conversationRows(markup, 11)) {
      expect(rowClasses(row)).toContain("bg-sidebar-accent");
      expect(row).toContain('aria-current="page"');
    }
  });

  test("does not keep a conversation highlighted when no conversation is open", () => {
    const markup = sidebar();
    for (const id of [10, 11]) {
      const rows = conversationRows(markup, id);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(rowClasses(row)).not.toContain("bg-sidebar-accent");
        expect(row).not.toContain("aria-current");
      }
    }
  });
});
