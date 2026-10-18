import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProjectPanel } from "../src/app/project-panel.tsx";
import { SnapshotProvider } from "../src/app/query-client.tsx";
import { WithFiles } from "../src/app/workspace-layout.tsx";
import { Button } from "../src/components/ui/button.tsx";
import { TooltipProvider } from "../src/components/ui/tooltip.tsx";
import { useWorkbench, WorkbenchFixtureProvider } from "./panel-services.ts";
import "../src/index.css";

function LayoutFixture() {
  const { filesShown, showFiles } = useWorkbench();
  const [workspaceId, setWorkspaceId] = useState<number | null>(1);
  const [available, setAvailable] = useState([1, 2]);
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  return (
    <div className="flex h-dvh flex-col">
      <div className="flex shrink-0 flex-wrap gap-1">
        <Button onClick={() => showFiles(!filesShown)}>Toggle panel</Button>
        <Button onClick={() => setWorkspaceId(1)}>Project one</Button>
        <Button onClick={() => setWorkspaceId(2)}>Project two</Button>
        <Button onClick={() => setWorkspaceId(null)}>No conversation</Button>
        <Button
          onClick={() => {
            setAvailable([2]);
            setWorkspaceId(2);
          }}
        >
          Remove project one
        </Button>
        <Button onClick={() => setVisible(!visible)}>{visible ? "Hide workbench" : "Show workbench"}</Button>
        <Button onClick={() => setMounted(false)}>Dispose workbench</Button>
      </div>
      <div
        data-testid="workspace-host"
        className="min-h-0 flex-1 flex-col"
        style={{ display: visible ? "flex" : "none" }}
      >
        {mounted && (
          <WithFiles workspaceId={workspaceId} availableWorkspaceIds={available}>
            <input aria-label="Chat draft" defaultValue="" />
          </WithFiles>
        )}
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <TooltipProvider>
      <SnapshotProvider>
        <WorkbenchFixtureProvider>
          {location.search.includes("layout") ? (
            <LayoutFixture />
          ) : (
            <div data-testid="panel" style={{ width: 240, height: "100dvh" }}>
              <ProjectPanel workspaceId={1} onClose={() => {}} />
            </div>
          )}
        </WorkbenchFixtureProvider>
      </SnapshotProvider>
    </TooltipProvider>,
  );
