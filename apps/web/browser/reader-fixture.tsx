import type { Files } from "@tandem/contracts";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChangeDiff } from "../src/changes/change-diff.tsx";
import { CommentDraft } from "../src/comments/comment-box.tsx";
import type { ProjectComments } from "../src/comments/project-comments.ts";
import { ReaderSurface } from "../src/components/reader-surface.tsx";
import { Button } from "../src/components/ui/button.tsx";
import { Drawer, DrawerContent, DrawerTitle } from "../src/components/ui/drawer.tsx";
import { FileView } from "../src/files/file-view.tsx";
import { ProjectFiles } from "../src/files/project-files.ts";
import "../src/index.css";

function Fixture() {
  const [drawer, setDrawer] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Button onClick={() => setDrawer(true)}>Open panel</Button>
      <Drawer open={drawer} onOpenChange={setDrawer}>
        <DrawerContent className="h-[70dvh]">
          <DrawerTitle>Project panel</DrawerTitle>
          <ReaderSurface label="File example.ts" expanded={expanded} onExpandedChange={setExpanded}>
            <Button aria-label={expanded ? "Exit full screen" : "Full screen"} onClick={() => setExpanded(!expanded)}>
              Toggle full screen
            </Button>
            <div data-testid="reader-scroll" className="min-h-0 flex-1 overflow-auto">
              <Button onClick={() => setEditing(true)}>Write comment</Button>
              {editing && <CommentDraft onSave={async () => setEditing(false)} onCancel={() => setEditing(false)} />}
              <pre>{"A line of code\n".repeat(200)}</pre>
            </div>
          </ReaderSurface>
        </DrawerContent>
      </Drawer>
    </>
  );
}
function DiffFixture() {
  const [value, setValue] = useState("one");
  const comments = {
    workspaceId: 1,
    start: async (anchor: { side?: string }, _text: string) => {
      document.body.dataset.savedSide = anchor.side ?? "additions";
      return 1;
    },
  } as ProjectComments;
  return (
    <div className="flex h-dvh flex-col">
      <Button onClick={() => setValue("two")}>Update patch</Button>
      <div className="min-h-0 flex-1">
        <ChangeDiff
          path="a.ts"
          style="split"
          comments={comments}
          patch={{
            kind: "patch",
            patch: `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,3 @@\n context\n-old\n+${value}\n tail\n`,
          }}
        />
      </div>
    </div>
  );
}
function FileFixture() {
  const large = location.search.includes("long");
  const [files] = useState(() => {
    const files = new ProjectFiles(
      {
        list: async () => [],
        read: async () => ({
          kind: "text",
          text: large
            ? Array.from(
                { length: 20000 },
                (_, index) =>
                  `row ${index + 1}: ${document.body.dataset.fileValue ?? "one"}${index === 14999 ? " long line".repeat(100) : ""}`,
              ).join("\n")
            : `const longValue = "${"x".repeat(200)}";\n`,
          size: 400000,
        }),
      } as unknown as Files,
      1,
    );
    files.open("example.ts");
    return files;
  });
  return (
    <div className="flex h-dvh flex-col">
      {large && (
        <div className="flex shrink-0 gap-2">
          <Button onClick={() => files.open("example.ts", { line: 15000 })}>Reveal line 15000</Button>
          <Button
            onClick={() => {
              document.body.dataset.fileValue = "two";
              files.refresh();
            }}
          >
            Update file
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <FileView
          files={files}
          comments={
            {
              workspaceId: 1,
              start: async (anchor: { line: number }) => {
                document.body.dataset.savedLine = String(anchor.line);
                return 1;
              },
            } as ProjectComments
          }
        />
      </div>
    </div>
  );
}
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    location.search.includes("diff") ? (
      <DiffFixture />
    ) : location.search.includes("file") ? (
      <FileFixture />
    ) : (
      <Fixture />
    ),
  );
