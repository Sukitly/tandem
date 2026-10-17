import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ProjectPanel } from "../src/app/project-panel.tsx";
import { WithFiles } from "../src/app/workspace-layout.tsx";

const mobileState = vi.hoisted(() => ({
  isMobile: false,
  filesShown: false,
}));

vi.mock("../src/hooks/use-mobile.ts", () => ({
  useIsMobile: () => mobileState.isMobile,
}));

vi.mock("../src/app/workbench.tsx", () => ({
  panelTabOf: (value: unknown) => (value === "changes" || value === "terminal" ? value : "files"),
  useWorkbench: () => ({
    filesShown: mobileState.filesShown,
    showFiles: vi.fn(),
    panelTab: "files",
    showTab: vi.fn(),
    changeTarget: null,
    showHiddenFiles: false,
    setShowHiddenFiles: vi.fn(),
    projectFiles: () => ({
      subscribe: () => () => {},
      current: { failure: null, opened: null },
      refresh: vi.fn(),
      dismissFailure: vi.fn(),
    }),
    comments: () => ({}),
  }),
}));

vi.mock("../src/files/project-files.ts", () => ({
  useProjectFiles: (_files: unknown, select: (f: unknown) => unknown) => select({ failure: null, opened: null }),
}));

vi.mock("../src/rpc/use-project-changes.ts", () => ({
  useProjectChanges: () => undefined,
  useProjectChangesFailure: () => null,
}));

vi.mock("../src/files/file-tree.tsx", () => ({
  FileTree: () => createElement("div", { "data-testid": "file-tree" }),
}));

vi.mock("../src/files/file-view.tsx", () => ({
  FileView: () => null,
}));

vi.mock("../src/changes/changes-view.tsx", () => ({
  ChangesView: () => null,
}));

vi.mock("../src/terminals/terminals-view.tsx", () => ({
  TerminalsView: () => null,
}));

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectPanel mobile close button", () => {
  test("does not render a close button when onClose is not provided (desktop side-panel mode)", () => {
    const markup = renderToStaticMarkup(createElement(ProjectPanel, { workspaceId: 1 }));
    expect(markup).not.toContain('aria-label="Close"');
    expect(markup).toContain('aria-label="Refresh"');
  });

  test("renders a close button when onClose is provided (mobile drawer mode)", () => {
    const markup = renderToStaticMarkup(createElement(ProjectPanel, { workspaceId: 1, onClose: vi.fn() }));
    expect(markup).toContain('aria-label="Close"');
    expect(markup).toContain("lucide-x");
  });
});

describe("WithFiles responsive layout", () => {
  test("renders ResizablePanelGroup on desktop", () => {
    mobileState.isMobile = false;
    mobileState.filesShown = true;
    const markup = renderToStaticMarkup(
      createElement(WithFiles, { workspaceId: 1 }, createElement("div", null, "Chat")),
    );
    expect(markup).toContain('data-slot="resizable-panel-group"');
    expect(markup).toContain('data-slot="resizable-panel"');
    expect(markup).toContain("Chat");
  });

  test("keeps the conversation in the same layout tree on mobile", () => {
    mobileState.isMobile = true;
    mobileState.filesShown = false;
    const markup = renderToStaticMarkup(
      createElement(WithFiles, { workspaceId: 1 }, createElement("div", null, "Chat")),
    );
    expect(markup).toContain('id="conversation"');
    expect(markup).toContain("Chat");
  });
});
