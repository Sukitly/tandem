import type { FileEntry } from "@tandem/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
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

vi.mock("../src/app/workbench.tsx", async () =>
  (await import("./workbench-mock.ts")).workbenchMock(() => mockWorkbench, {
    panelTabOf: (value: unknown) => (value === "changes" || value === "terminal" ? value : "files"),
  }),
);

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
  });

  test("shows dimmed entries when showHidden is true", () => {
    const markup = renderToStaticMarkup(
      createElement(SidebarProvider, null, createElement(FileTree, { files: dummyFiles, showHidden: true })),
    );

    expect(markup).toContain('title=".git"');
    expect(markup).toContain('title=".DS_Store"');
    expect(markup).toContain('title="node_modules"');
  });
});
