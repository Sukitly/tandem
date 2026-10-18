import { FileIcon } from "@react-symbols/icons/utils";
import type { ChangedFile, ChangesState } from "@tandem/contracts";
import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar.tsx";
import { cn } from "@/lib/utils.ts";
import {
  ADDITIONS_COLOR,
  type CountPart,
  countParts,
  DELETIONS_COLOR,
  statusColor,
  statusLabel,
  statusLetter,
} from "./change-status.ts";

export function ChangedFilesList({
  state,
  selected,
  onSelect,
}: {
  state: ChangesState;
  selected: string | null;
  onSelect(path: string): void;
}) {
  return (
    <>
      {state.message !== undefined && (
        <div className="p-2">
          <Alert variant={state.status === "ready" ? "default" : "destructive"}>
            <AlertCircleIcon />
            <AlertTitle>{titleOf(state.status)}</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        </div>
      )}
      <p className="flex shrink-0 flex-wrap items-baseline gap-x-2 px-3 py-2 text-xs text-muted-foreground">
        <span>
          {state.files.length === 0
            ? "No changed files"
            : `${state.files.length} changed ${state.files.length === 1 ? "file" : "files"}`}
          {state.base !== undefined && ` against ${state.base}`}
        </span>
        <Totals files={state.files} />
      </p>
      <SidebarMenu aria-label="Changed files">
        {state.files.map((file) => (
          <SidebarMenuItem key={file.path}>
            <SidebarMenuButton isActive={file.path === selected} onClick={() => onSelect(file.path)}>
              <span className={cn("w-3 shrink-0 font-medium", statusColor(file.status))}>
                {statusLetter(file.status)}
              </span>
              <FileIcon fileName={file.path.split("/").pop() ?? file.path} autoAssign />
              <span className="truncate font-mono text-xs" title={statusLabel(file.status, file.from)}>
                {file.path}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1 text-xs tabular-nums">
                {countParts(file.additions, file.deletions).map((part) => (
                  <span key={part.kind} className={part.kind === "additions" ? ADDITIONS_COLOR : DELETIONS_COLOR}>
                    {part.text}
                  </span>
                ))}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </>
  );
}

function Totals({ files }: { files: readonly ChangedFile[] }) {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions ?? 0;
    deletions += file.deletions ?? 0;
  }
  const parts: CountPart[] = countParts(additions, deletions);
  if (parts.length === 0) return null;
  return (
    <span className="flex items-center gap-1 font-mono tabular-nums">
      {parts.map((part) => (
        <span key={part.kind} className={part.kind === "additions" ? ADDITIONS_COLOR : DELETIONS_COLOR}>
          {part.text}
        </span>
      ))}
    </span>
  );
}

function titleOf(status: "ready" | "notRepository" | "error"): string {
  if (status === "notRepository") return "Not a Git repository";
  return status === "error" ? "Cannot read the changes" : "Changes";
}
