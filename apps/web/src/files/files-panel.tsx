import { useEffect } from "react";
import { toast } from "sonner";
import type { ProjectComments } from "@/comments/project-comments.ts";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable.tsx";
import { FileTree } from "./file-tree.tsx";
import { FileView } from "./file-view.tsx";
import { type ProjectFiles, useProjectFiles } from "./project-files.ts";

export function FilesPanel({
  files,
  comments,
  active,
  showHidden,
}: {
  files: ProjectFiles;
  comments: ProjectComments;
  active: boolean;
  showHidden: boolean;
}) {
  const failure = useProjectFiles(files, (current) => current.failure);
  const opened = useProjectFiles(files, (current) => current.opened !== null);
  useEffect(() => {
    if (failure === null) return;
    toast.error("Cannot list a directory", { description: failure });
    files.dismissFailure();
  }, [files, failure]);
  return (
    <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
      <ResizablePanel id="tree" minSize={80} className="overflow-auto p-2">
        <FileTree files={files} showHidden={showHidden} />
      </ResizablePanel>
      {opened && (
        <>
          <ResizableHandle />
          <ResizablePanel id="file" defaultSize="60" minSize={120}>
            <FileView files={files} comments={comments} active={active} />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
