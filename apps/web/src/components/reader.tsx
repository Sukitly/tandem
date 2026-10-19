import { Maximize2Icon, Minimize2Icon, XIcon } from "lucide-react";
import { createContext, type ReactNode, type RefObject, useContext, useEffect, useRef, useState } from "react";
import { IconAction } from "@/components/icon-action.tsx";
import { CopyPathButton } from "./copy-path-button.tsx";
import { ReaderSurface } from "./reader-surface.tsx";
import { Button } from "./ui/button.tsx";

interface ReaderState {
  expanded: boolean;
  setExpanded(expanded: boolean): void;
  toggleRef: RefObject<HTMLButtonElement | null>;
}
const Context = createContext<ReaderState | null>(null);
export function useReader(): ReaderState {
  const reader = useContext(Context);
  if (reader === null) throw new Error("Reader controls require a Reader");
  return reader;
}

/** Owns expansion and focus, but knows nothing about files, diffs, fetching or comments. */
export function Reader({ label, active = true, children }: { label: string; active?: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!active) setExpanded(false);
  }, [active]);
  return (
    <Context.Provider value={{ expanded, setExpanded, toggleRef }}>
      <ReaderSurface label={label} expanded={expanded} onExpandedChange={setExpanded} toggleRef={toggleRef}>
        {children}
      </ReaderSurface>
    </Context.Provider>
  );
}
export function ReaderHeader({ children }: { children: ReactNode }) {
  return <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3">{children}</header>;
}
export function ReaderPath({ path, title = path }: { path: string; title?: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <p className="min-w-0 truncate font-mono text-xs" title={title}>
        {path}
      </p>
      <CopyPathButton key={path} path={path} />
    </div>
  );
}
export function ReaderBody({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1">{children}</div>;
}
export function ReaderExpandButton() {
  const { expanded, setExpanded, toggleRef } = useReader();
  const label = expanded ? "Exit full screen" : "Full screen";
  return (
    <IconAction
      ref={toggleRef}
      variant={expanded ? "secondary" : "ghost"}
      size="icon-xs"
      label={label}
      aria-pressed={expanded}
      onClick={() => setExpanded(!expanded)}
    >
      {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
    </IconAction>
  );
}
export function ReaderCloseButton({ label, onClose }: { label: string; onClose(): void }) {
  const { setExpanded } = useReader();
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      onClick={() => {
        setExpanded(false);
        onClose();
      }}
    >
      <XIcon />
    </Button>
  );
}
