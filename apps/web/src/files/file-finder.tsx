import { useId, useState } from "react";
import { CodeCopyButton } from "@/components/copy-text.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useCompositionGuard } from "@/hooks/use-composition-guard.ts";

/** The first line after `after` (from the top when there is none) that holds `query`, wrapping round; `null` if none. */
export function nextMatch(lines: readonly string[], query: string, after: number | null): number | null {
  const needle = query.toLowerCase();
  for (let offset = 0; offset < lines.length; offset += 1) {
    const index = ((after === null ? 0 : after + 1) + offset) % lines.length;
    if (lines[index]?.toLowerCase().includes(needle)) return index;
  }
  return null;
}

/**
 * Finding a place in a file too long to show whole: a line by number, or the next line that holds some text. `goTo`
 * takes the file's view to a line.
 */
export function useFileFinder(lines: readonly string[], goTo: (line: number) => void) {
  const [line, setLine] = useState("1");
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const target = Number(line);
  const valid = Number.isSafeInteger(target) && target >= 1 && target <= lines.length;
  return {
    line,
    setLine,
    valid,
    query,
    status,
    changeQuery(value: string): void {
      setQuery(value);
      setMatch(null);
      setStatus(null);
    },
    goToLine(): void {
      if (valid) goTo(target);
    },
    findNext(): void {
      if (query === "") return;
      const index = nextMatch(lines, query, match);
      setMatch(index);
      if (index === null) {
        setStatus("No matching line");
        return;
      }
      setLine(String(index + 1));
      setStatus(`Found on line ${index + 1}`);
      goTo(index + 1);
    },
  };
}

export type FileFinder = ReturnType<typeof useFileFinder>;

export function FileFinderBar({ finder, lineCount, text }: { finder: FileFinder; lineCount: number; text: string }) {
  const inputId = useId();
  const composition = useCompositionGuard();
  return (
    <form
      className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs"
      onSubmit={(event) => {
        event.preventDefault();
        if (!composition.active()) finder.goToLine();
      }}
    >
      <label htmlFor={inputId}>Line</label>
      <Input
        id={inputId}
        type="number"
        min={1}
        max={lineCount}
        required
        value={finder.line}
        onChange={(event) => finder.setLine(event.target.value)}
        className="w-24"
      />
      <Button type="submit" size="sm" variant="outline" disabled={!finder.valid}>
        Go to line
      </Button>
      <CodeCopyButton value={text} aria-label="Copy entire file" />
      <Input
        type="search"
        aria-label="Search file"
        placeholder="Search file"
        value={finder.query}
        className="w-40"
        onChange={(event) => finder.changeQuery(event.target.value)}
        onCompositionStart={composition.onCompositionStart}
        onCompositionEnd={composition.onCompositionEnd}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !composition.owns(event)) {
            event.preventDefault();
            finder.findNext();
          }
        }}
      />
      <Button type="button" size="sm" variant="outline" disabled={finder.query === ""} onClick={finder.findNext}>
        Find next line
      </Button>
      {finder.status !== null && <span role="status">{finder.status}</span>}
      <p className="w-full text-muted-foreground">
        Large file: only nearby lines are rendered. Search here, jump to a line, or copy the entire file.
      </p>
    </form>
  );
}
