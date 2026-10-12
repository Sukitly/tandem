import type { FileEntry } from "@tandem/contracts";
import { FileIcon, FileSymlinkIcon, FolderClosedIcon, FolderOpenIcon, FolderSymlinkIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { isDimmed } from "./dimmed.ts";
import { formatSize } from "./format-size.ts";
import { type ProjectFiles, useProjectFiles } from "./project-files.ts";

/**
 * A project's files as a tree, built as shadcn's file tree block (`sidebar-11`) is: sidebar menu items, with
 * collapsible directories. As in the sidebar's project rows, an open or closed folder icon shows whether a directory is
 * expanded, without the block's arrow, so files and directories line up. A directory is listed when it first opens.
 */
export function FileTree({ files }: { files: ProjectFiles }) {
  return (
    <SidebarMenu aria-label="Files">
      <Entries files={files} path="" />
    </SidebarMenu>
  );
}

/** `dimmed` comes from the directory an entry is in: everything below a hidden or ignored directory is dimmed too. */
interface EntryProps {
  files: ProjectFiles;
  entry: FileEntry;
  dimmed: boolean;
}

/** A directory's entries, listed when they are first shown. */
function Entries({ files, path, dimmed = false }: { files: ProjectFiles; path: string; dimmed?: boolean }) {
  const listed = useProjectFiles(files, (current) => current.directory(path));
  useEffect(() => files.load(path), [files, path]);
  if (listed === undefined || listed.status === "loading") {
    return (
      <SidebarMenuItem>
        <SidebarMenuSkeleton showIcon />
      </SidebarMenuItem>
    );
  }
  if (listed.status === "failed") return null;
  return listed.value.map((entry) => {
    const entryDimmed = isDimmed(entry, dimmed);
    return entry.kind === "directory" ? (
      <Directory key={entry.path} files={files} entry={entry} dimmed={entryDimmed} />
    ) : (
      <File key={entry.path} files={files} entry={entry} dimmed={entryDimmed} />
    );
  });
}

function Directory({ files, entry, dimmed }: EntryProps) {
  const open = useProjectFiles(files, (current) => current.isExpanded(entry.path));
  const Icon = entry.symlink === true ? FolderSymlinkIcon : open ? FolderOpenIcon : FolderClosedIcon;
  return (
    <Collapsible open={open} onOpenChange={(next) => files.setExpanded(entry.path, next)} render={<SidebarMenuItem />}>
      <CollapsibleTrigger render={<SidebarMenuButton title={entry.path} className={cn(dimmed && "opacity-30")} />}>
        <Icon />
        <span>{entry.name}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          <Entries files={files} path={entry.path} dimmed={dimmed} />
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}

function File({ files, entry, dimmed }: EntryProps) {
  // Only the opened file's row follows what is opened, so opening a file renders two rows, not the whole tree.
  const opened = useProjectFiles(files, (current) => (current.opened?.path === entry.path ? current.opened : null));
  const button = useRef<HTMLButtonElement>(null);
  // Each request to show this file brings it into view, as when a link in a message opens it.
  useEffect(() => {
    if (opened !== null) button.current?.scrollIntoView({ block: "nearest" });
  }, [opened]);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        ref={button}
        title={entry.path}
        isActive={opened !== null}
        className={cn(dimmed && "opacity-30")}
        onClick={() => files.open(entry.path)}
      >
        {entry.symlink === true ? <FileSymlinkIcon /> : <FileIcon />}
        <span className="truncate">{entry.name}</span>
        {entry.size !== undefined && (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{formatSize(entry.size)}</span>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
