import type { ProjectDirectory } from "@tandem/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { ProjectDirectoryPicker } from "../src/app/add-project-dialog.tsx";

function picker(directory: ProjectDirectory | null, busy = false): string {
  return renderToStaticMarkup(createElement(ProjectDirectoryPicker, { directory, busy, onNavigate: vi.fn() }));
}

function button(markup: string, label: string): string | undefined {
  return markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find((element) => element.includes(label));
}

const directory: ProjectDirectory = {
  path: "/projects",
  parent: "/",
  directories: [
    { name: "app", path: "/projects/app" },
    { name: ".hidden", path: "/projects/.hidden" },
  ],
};

describe("project directory picker", () => {
  test("offers directory buttons and navigation instead of a path input or a file upload", () => {
    const markup = picker(directory);
    expect(markup).toContain("/projects");
    expect(button(markup, ">app<")).toContain('data-slot="button"');
    expect(button(markup, ">.hidden<")).toBeDefined();
    expect(button(markup, 'aria-label="Home directory"')).not.toContain('disabled=""');
    expect(button(markup, 'aria-label="Parent directory"')).not.toContain('disabled=""');
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("webkitdirectory");
  });

  test("disables navigation during loading and project creation", () => {
    const markup = picker(directory, true);
    for (const label of ['aria-label="Home directory"', 'aria-label="Parent directory"', ">app<", ">.hidden<"]) {
      expect(button(markup, label)).toContain('disabled=""');
    }
    expect(markup).toContain('aria-busy="true"');
  });

  test("disables parent navigation at the root and shows an empty directory", () => {
    const markup = picker({ path: "/", parent: null, directories: [] });
    expect(button(markup, 'aria-label="Parent directory"')).toContain('disabled=""');
    expect(button(markup, 'aria-label="Home directory"')).not.toContain('disabled=""');
    expect(markup).toContain("No subdirectories");
  });

  test("does not show a selected path before the first directory arrives", () => {
    const markup = picker(null, true);
    expect(markup).toContain("Choose a directory");
    expect(button(markup, 'aria-label="Parent directory"')).toContain('disabled=""');
    expect(markup).not.toContain("No subdirectories");
  });
});
