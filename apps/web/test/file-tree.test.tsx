import type { FileEntry } from "@tandem/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { ProjectPanel } from "../src/app/project-panel.tsx";
import { SidebarProvider } from "../src/components/ui/sidebar.tsx";
import { FileTree } from "../src/files/file-tree.tsx";
import type { ProjectFiles } from "../src/files/project-files.ts";

const entries: FileEntry[] = [
  { name: ".git", path: ".git", kind: "directory" },
  { name: "apps", path: "apps", kind: "directory" },
  { name: "node_modules", path: "node_modules", kind: "directory", ignored: true },
  { name: ".editorconfig", path: ".editorconfig", kind: "file" },
  { name: ".gitignore", path: ".gitignore", kind: "file" },
  { name: ".DS_Store", path: ".DS_Store", kind: "file" },
  { name: "README.md", path: "README.md", kind: "file" },
];

vi.mock("../src/files/project-files.ts", () => ({
  useProjectFiles: (_files: unknown, select: (f: unknown) => unknown) =>
    select({
      directory: () => ({ status: "ready", value: entries }),
      isExpanded: () => false,
      opened: null,
      failure: null,
    }),
}));

const mockWorkbench = vi.hoisted(() => ({
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
}));

vi.mock("../src/app/workbench.tsx", () => ({
  panelTabOf: (value: unknown) => (value === "changes" || value === "terminal" ? value : "files"),
  useWorkbench: () => mockWorkbench,
}));

vi.mock("../src/rpc/use-project-changes.ts", () => ({
  useProjectChanges: () => undefined,
  useProjectChangesFailure: () => null,
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

function buttonFor(markup: string, title: string): string {
  const match = markup.match(new RegExp(`<button[^>]*title="${title.replace(".", "\\.")}"[^>]*>`));
  return match ? match[0] : "";
}

describe("FileTree hidden file filtering and dimming", () => {
  const dummyFiles = {
    load: vi.fn(),
  } as unknown as ProjectFiles;

  test("hides dimmed entries (VCS metadata, OS metadata, and Git-ignored entries) by default", () => {
    const markup = renderToStaticMarkup(
      createElement(SidebarProvider, null, createElement(FileTree, { files: dummyFiles, showHidden: false })),
    );

    expect(markup).not.toContain('title=".git"');
    expect(markup).not.toContain('title=".DS_Store"');
    expect(markup).not.toContain('title="node_modules"');

    expect(markup).toContain('title=".editorconfig"');
    expect(markup).toContain('title=".gitignore"');
    expect(markup).toContain('title="README.md"');

    // .editorconfig, .gitignore, README.md are not dimmed
    expect(buttonFor(markup, ".editorconfig")).not.toContain("opacity-30");
    expect(buttonFor(markup, ".gitignore")).not.toContain("opacity-30");
    expect(buttonFor(markup, "README.md")).not.toContain("opacity-30");
  });

  test("shows dimmed entries with opacity-30 when showHidden is true", () => {
    const markup = renderToStaticMarkup(
      createElement(SidebarProvider, null, createElement(FileTree, { files: dummyFiles, showHidden: true })),
    );

    expect(markup).toContain('title=".git"');
    expect(markup).toContain('title=".DS_Store"');
    expect(markup).toContain('title="node_modules"');
    expect(buttonFor(markup, ".git")).toContain("opacity-30");
    expect(buttonFor(markup, ".DS_Store")).toContain("opacity-30");
    expect(buttonFor(markup, "node_modules")).toContain("opacity-30");

    // Regular dotfiles still not dimmed
    expect(buttonFor(markup, ".editorconfig")).not.toContain("opacity-30");
    expect(buttonFor(markup, ".gitignore")).not.toContain("opacity-30");
  });
});

describe("ProjectPanel toggle hidden files button", () => {
  test("renders toggle button to show hidden files when hidden", () => {
    mockWorkbench.showHiddenFiles = false;
    const markup = renderToStaticMarkup(
      createElement(SidebarProvider, null, createElement(ProjectPanel, { workspaceId: 1 })),
    );

    expect(markup).toContain('aria-label="Show hidden files"');
    expect(markup).toContain('aria-label="Refresh"');
  });

  test("renders toggle button to hide hidden files when shown", () => {
    mockWorkbench.showHiddenFiles = true;
    const markup = renderToStaticMarkup(
      createElement(SidebarProvider, null, createElement(ProjectPanel, { workspaceId: 1 })),
    );

    expect(markup).toContain('aria-label="Hide hidden files"');
  });
});
