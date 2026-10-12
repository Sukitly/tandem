import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { asyncDataLoaderFeature, hotkeysCoreFeature, selectionFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import type { FileEntry } from "@tandem/contracts";
import {
  ChevronRightIcon,
  FileIcon,
  FileSymlinkIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  FolderSymlinkIcon,
} from "lucide-react";
import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useConnected } from "@/rpc/connection.tsx";

/** The tree's root item, the project's directory; `.` is a path the server takes for it. Other items are their paths. */
const ROOT = ".";
const INDENT = 12;

/**
 * A project's files as a tree, each directory listed when it is first expanded. Expanded directories are kept by the
 * owner, so that a refresh, which mounts the tree again, lists them again and keeps them open.
 */
export function FileTree({
  workspaceId,
  expanded,
  onExpandedChange,
  selected,
  reveal,
  onOpen,
  onError,
}: {
  workspaceId: number;
  expanded: string[];
  onExpandedChange(expanded: string[]): void;
  /** The file shown in the viewer. */
  selected: string | undefined;
  /** Changes when `selected` should be scrolled into view, once its directories have loaded. */
  reveal: number;
  onOpen(path: string): void;
  onError(message: string): void;
}) {
  const { files } = useConnected();
  const tree = useTree<FileEntry>({
    rootItemId: ROOT,
    getItemName: (item) => item.getItemData()?.name ?? "",
    isItemFolder: (item) => item.getId() === ROOT || item.getItemData()?.kind === "directory",
    dataLoader: {
      // Items arrive with their directory's listing; only the root is asked for on its own.
      getItem: (id) => ({ name: id.slice(id.lastIndexOf("/") + 1), path: id, kind: "directory" }),
      getChildrenWithData: async (id) => {
        try {
          const entries = await files.list({ workspaceId, path: id }, BACKGROUND_CONTEXT);
          return entries.map((entry) => ({ id: entry.path, data: entry }));
        } catch (error) {
          onError(error instanceof Error ? error.message : String(error));
          return [];
        }
      },
    },
    state: { expandedItems: expanded, selectedItems: selected === undefined ? [] : [selected] },
    setExpandedItems: (update) => onExpandedChange(typeof update === "function" ? update(expanded) : update),
    onPrimaryAction: (item) => {
      if (!item.isFolder()) onOpen(item.getId());
    },
    indent: INDENT,
    features: [asyncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reveal` asks for the selected file to be shown again.
  useEffect(() => {
    if (selected === undefined) return;
    let current = true;
    void (async () => {
      for (const directory of ancestors(selected)) await tree.loadChildrenIds(directory);
      if (current) await tree.getItemInstance(selected)?.scrollTo({ block: "nearest" });
    })();
    return () => {
      current = false;
    };
  }, [reveal]);

  return (
    <div {...tree.getContainerProps("Files")} className="flex flex-col py-1 outline-none">
      {tree.getItems().map((item) => {
        const entry = item.getItemData();
        const folder = item.isFolder();
        const Icon =
          entry?.symlink === true
            ? folder
              ? FolderSymlinkIcon
              : FileSymlinkIcon
            : folder
              ? item.isExpanded()
                ? FolderOpenIcon
                : FolderClosedIcon
              : FileIcon;
        return (
          <button
            {...item.getProps()}
            key={item.getId()}
            type="button"
            title={item.getId()}
            className={cn(
              "flex h-6 w-full shrink-0 cursor-pointer items-center gap-1.5 pr-2 text-left text-sm outline-none hover:bg-muted [&_svg]:size-4 [&_svg]:shrink-0",
              item.isSelected() && "bg-muted font-medium",
              item.isFocused() && "focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
            )}
            style={{ paddingLeft: item.getItemMeta().level * INDENT + 8 }}
          >
            {folder ? (
              <ChevronRightIcon
                className={cn("text-muted-foreground transition-transform", item.isExpanded() && "rotate-90")}
              />
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <Icon className="text-muted-foreground" />
            <span className="truncate">{item.getItemName()}</span>
            {item.isLoading() && <Spinner className="ml-auto" />}
          </button>
        );
      })}
    </div>
  );
}

/** The directories a path is in, from the root down: `a/b/c.ts` is in the root, `a`, and `a/b`. */
export function ancestors(path: string): string[] {
  const segments = path.split("/").slice(0, -1);
  return [ROOT, ...segments.map((_, index) => segments.slice(0, index + 1).join("/"))];
}
