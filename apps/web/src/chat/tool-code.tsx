import { File, PatchDiff } from "@pierre/diffs/react";
import { useTheme } from "@/theme.tsx";

const BOX = "max-h-80 min-w-0 overflow-auto rounded-lg border border-border/70 text-xs";

/** An edit's change as a patch, drawn the way the Changes panel draws a file's diff. */
export function ToolPatch({ patch }: { patch: string }) {
  const { choice } = useTheme();
  return (
    <div className={BOX}>
      <PatchDiff
        patch={patch}
        options={{
          theme: { dark: "github-dark", light: "github-light" },
          themeType: choice,
          diffStyle: "unified",
          disableFileHeader: true,
          overflow: "scroll",
        }}
      />
    </div>
  );
}

/** What a write put in the file, highlighted by the file's extension. */
export function ToolFile({ path, content }: { path: string; content: string }) {
  const { choice } = useTheme();
  return (
    <div className={BOX}>
      <File
        file={{ name: path, contents: content }}
        options={{
          theme: { dark: "github-dark", light: "github-light" },
          themeType: choice,
          disableFileHeader: true,
          overflow: "scroll",
        }}
      />
    </div>
  );
}
