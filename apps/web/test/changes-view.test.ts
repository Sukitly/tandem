import { FileIcon } from "@react-symbols/icons/utils";
import type { ChangedFile, ChangesState } from "@tandem/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SnapshotProvider } from "../src/app/query-client.tsx";
import { ChangesView } from "../src/changes/changes-view.tsx";
import type { ProjectComments } from "../src/comments/project-comments.ts";
import { SidebarProvider } from "../src/components/ui/sidebar.tsx";

const state = vi.hoisted(() => ({
  changes: { workspaceId: 1, status: "ready", files: [] } as ChangesState,
}));

vi.mock("../src/rpc/use-replicated-state.ts", () => ({
  useReplicatedState: () => state.changes,
}));

vi.mock("../src/app/workbench.tsx", async () =>
  (await import("./workbench-mock.ts")).workbenchMock(() => ({ openFile: vi.fn(), forgetChangeTarget: vi.fn() })),
);

vi.mock("../src/changes/change-diff.tsx", () => ({
  ChangeDiff: () => null,
}));

beforeEach(() => {
  state.changes.files = [];
  vi.stubGlobal("localStorage", { getItem: () => null });
});

afterEach(() => vi.unstubAllGlobals());

function changes(): string {
  return renderToStaticMarkup(
    createElement(
      SnapshotProvider,
      null,
      createElement(
        SidebarProvider,
        null,
        createElement(ChangesView, {
          changes: undefined,
          failure: null,
          comments: {} as ProjectComments,
        }),
      ),
    ),
  );
}

describe("the changed files list", () => {
  test("sums every changed file's line counts in the header", () => {
    state.changes.files = [
      { path: "src/a.ts", status: "modified", additions: 10, deletions: 2 },
      { path: "src/b.ts", status: "added", additions: 5 },
      { path: "logo.png", status: "added" },
      { path: "src/c.ts", status: "deleted", deletions: 7 },
    ];
    const markup = changes();
    expect(markup).toContain("4 changed files");
    expect(markup).toContain("+15");
    expect(markup).toContain("−9");
  });

  test("keeps Git status, rename information, and line counts alongside the icon", () => {
    const file: ChangedFile = {
      path: "src/new.tsx",
      from: "src/old.tsx",
      status: "renamed",
      additions: 12,
      deletions: 3,
    };
    state.changes.files = [file];
    const markup = changes();
    const icon = renderToStaticMarkup(createElement(FileIcon, { fileName: "new.tsx", autoAssign: true }));
    expect(markup).toContain(icon);
    expect(markup).toContain(">R</span>");
    expect(markup.indexOf(">R</span>")).toBeLessThan(markup.indexOf(icon));
    expect(markup.indexOf(icon)).toBeLessThan(markup.indexOf(file.path));
    expect(markup).toContain(file.path);
    expect(markup).toContain("src/old.tsx");
    expect(markup).toContain("+12");
    expect(markup).toContain("−3");
  });

  test("respects stored diff wrap preference", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key === "tandem.diffWrap" ? "true" : null),
    });
    state.changes.files = [{ path: "src/app.tsx", status: "modified" }];
    const markup = changes();
    expect(markup).toContain('aria-label="Do not wrap lines"');
    expect(markup).toContain('aria-pressed="true"');
  });
});
