import { parsePatchFiles } from "@pierre/diffs";
import { CodeView, type CodeViewDiffItem } from "@pierre/diffs/react";
import type { FilePatch } from "@tandem/contracts";
import { useMemo } from "react";
import { useTheme } from "@/theme.tsx";

/**
 * One file's patch, as `@pierre/diffs` renders it. The patch's own header is off: the panel's header names the path
 * already.
 */
export function ChangeDiff({ path, patch, style }: { path: string; patch: FilePatch; style: "split" | "unified" }) {
  const { choice } = useTheme();
  const text = patch.kind === "patch" ? patch.patch : "";
  const items = useMemo<CodeViewDiffItem[]>(() => {
    if (text.trim() === "") return [];
    const files = parsePatchFiles(text).flatMap((parsed) => parsed.files);
    // The patch itself is the item's identity: a rewritten patch is rendered, not taken for the one before it.
    return files.map((fileDiff, index) => ({
      id: `${path}#${text.length}#${index}`,
      type: "diff",
      fileDiff,
      annotations: [],
      version: 0,
    }));
  }, [path, text]);

  if (patch.kind !== "patch") {
    const message =
      patch.kind === "binary"
        ? "A binary file: there are no lines to show."
        : patch.kind === "tooLarge"
          ? "This file's diff is too large to show."
          : patch.message;
    return <p className="p-3 text-sm text-muted-foreground">{message}</p>;
  }
  if (items.length === 0) return <p className="p-3 text-sm text-muted-foreground">No line changes.</p>;
  return (
    <CodeView
      className="h-full overflow-auto text-xs"
      items={items}
      options={{
        theme: { dark: "github-dark", light: "github-light" },
        themeType: choice,
        diffStyle: style,
        disableFileHeader: true,
        overflow: "scroll",
      }}
    />
  );
}
