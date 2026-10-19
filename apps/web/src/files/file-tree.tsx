import { DefaultFolderOpenedIcon, FileIcon, FolderIcon, getIconForFolder } from "@react-symbols/icons/utils";
import type { FileEntry } from "@tandem/contracts";
import { FileSymlinkIcon } from "lucide-react";
import { isValidElement, useEffect, useRef, useState } from "react";
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
import { truncateEntries } from "./file-tree-limit.ts";
import { formatSize } from "./format-size.ts";
import { type ProjectFiles, useProjectFiles } from "./project-files.ts";

/**
 * A project's files as a tree, built as shadcn's file tree block (`sidebar-11`) is: sidebar menu items, with
 * collapsible directories. Icons come from the Symbols set (`@react-symbols/icons`), by file name and folder name: a
 * file shows its language's icon, and a folder with an icon of its own keeps it whether it is open or closed. A folder
 * without one shows the closed and open folders instead, so expanding stays visible. A directory is listed when it
 * first opens.
 */
export function FileTree({ files, showHidden = false }: { files: ProjectFiles; showHidden?: boolean }) {
  return (
    <SidebarMenu aria-label="Files">
      <Entries files={files} path="" showHidden={showHidden} />
    </SidebarMenu>
  );
}

/** `dimmed` comes from the directory an entry is in: everything below a hidden or ignored directory is dimmed too. */
interface DirectoryProps {
  files: ProjectFiles;
  entry: FileEntry;
  dimmed: boolean;
  showHidden: boolean;
}

interface FileProps {
  files: ProjectFiles;
  entry: FileEntry;
  dimmed: boolean;
}

/** A directory's entries, listed when they are first shown. */
function Entries({
  files,
  path,
  dimmed = false,
  showHidden = false,
}: {
  files: ProjectFiles;
  path: string;
  dimmed?: boolean;
  showHidden?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
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
  const all = showHidden ? listed.value : listed.value.filter((entry) => !isDimmed(entry, dimmed));
  const { shown, remaining } = expanded ? { shown: all, remaining: 0 } : truncateEntries(all);
  return (
    <>
      {shown.map((entry) => {
        const entryDimmed = isDimmed(entry, dimmed);
        return entry.kind === "directory" ? (
          <Directory key={entry.path} files={files} entry={entry} dimmed={entryDimmed} showHidden={showHidden} />
        ) : (
          <File key={entry.path} files={files} entry={entry} dimmed={entryDimmed} />
        );
      })}
      {remaining > 0 && (
        <SidebarMenuItem>
          <SidebarMenuButton
            className="text-xs text-muted-foreground"
            onClick={() => setExpanded(true)}
            aria-label={`Show ${remaining} more items`}
          >
            … and {remaining} more
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
    </>
  );
}

function Directory({ files, entry, dimmed, showHidden }: DirectoryProps) {
  const open = useProjectFiles(files, (current) => current.isExpanded(entry.path));
  // A folder with an icon of its own keeps it open or closed; one without shows the closed and open folders.
  const named = isValidElement(getIconForFolder({ folderName: entry.name }));
  const opened = !named && open;
  return (
    <Collapsible open={open} onOpenChange={(next) => files.setExpanded(entry.path, next)} render={<SidebarMenuItem />}>
      <CollapsibleTrigger render={<SidebarMenuButton title={entry.path} className={cn(dimmed && "opacity-30")} />}>
        {opened ? <DefaultFolderOpenedIcon /> : <FolderIcon folderName={entry.name} />}
        <span>{entry.name}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          <Entries files={files} path={entry.path} dimmed={dimmed} showHidden={showHidden} />
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}

function File({ files, entry, dimmed }: FileProps) {
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
        <FileIcon fileName={entry.name} autoAssign />
        <span className="truncate">{entry.name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {entry.symlink === true && <FileSymlinkIcon className="text-muted-foreground" />}
          {entry.size !== undefined && (
            <span className="text-xs text-muted-foreground tabular-nums">{formatSize(entry.size)}</span>
          )}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
