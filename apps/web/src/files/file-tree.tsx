import type { FileEntry } from "@tandem/contracts";
import {
  ChevronRightIcon,
  FileIcon,
  FileSymlinkIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  FolderSymlinkIcon,
} from "lucide-react";
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
import { type ProjectFiles, useProjectFiles } from "./project-files.ts";

/**
 * A project's files as a tree, built as shadcn's file tree block (`sidebar-11`) is: sidebar menu items, with
 * collapsible directories. A directory is listed when it first opens.
 */
export function FileTree({ files }: { files: ProjectFiles }) {
  return (
    <SidebarMenu aria-label="Files">
      <Entries files={files} path="" />
    </SidebarMenu>
  );
}

/** A directory's entries, listed when they are first shown. */
function Entries({ files, path }: { files: ProjectFiles; path: string }) {
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
  return listed.value.map((entry) =>
    entry.kind === "directory" ? (
      <Directory key={entry.path} files={files} entry={entry} />
    ) : (
      <File key={entry.path} files={files} entry={entry} />
    ),
  );
}

function Directory({ files, entry }: { files: ProjectFiles; entry: FileEntry }) {
  const open = useProjectFiles(files, (current) => current.isExpanded(entry.path));
  const Icon = entry.symlink === true ? FolderSymlinkIcon : open ? FolderOpenIcon : FolderClosedIcon;
  return (
    <Collapsible open={open} onOpenChange={(next) => files.setExpanded(entry.path, next)} render={<SidebarMenuItem />}>
      <CollapsibleTrigger render={<SidebarMenuButton title={entry.path} />}>
        <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
        <Icon />
        <span>{entry.name}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          <Entries files={files} path={entry.path} />
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}

function File({ files, entry }: { files: ProjectFiles; entry: FileEntry }) {
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
        onClick={() => files.open(entry.path)}
      >
        {entry.symlink === true ? <FileSymlinkIcon /> : <FileIcon />}
        <span>{entry.name}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
