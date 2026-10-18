import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { PREVIEW_SANDBOX_TOKENS, previewUrl } from "@tandem/contracts";
import { ExternalLinkIcon, GlobeIcon, PlusIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useWorkbench } from "@/app/workbench.tsx";
import { IconAction } from "@/components/icon-action.tsx";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty.tsx";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { type Connected, useOptionalConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { AddPortForm } from "./add-port-form.tsx";

export function PreviewView({ active = true }: { active?: boolean }) {
  const connected = useOptionalConnected();
  if (connected === null) return null;
  return <PreviewPanel connected={connected} active={active} />;
}

function PreviewPanel({ connected, active = true }: { connected: Connected; active?: boolean }) {
  const { preview } = connected;
  const { reportFailure } = useWorkbench((state) => ({ reportFailure: state.reportFailure }));
  const state = useReplicatedState(preview.state);
  const ports = useMemo(() => state?.ports ?? [], [state?.ports]);

  const [selectedPort, setSelectedPort] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const currentPort = ports.find((p) => p.port === selectedPort)?.port ?? ports[0]?.port ?? null;

  // Only visited ports get a frame. Switching tabs hides it without losing its document or form state.
  const [sessions, setSessions] = useState(
    () => new Map<number, number>(active && currentPort !== null ? [[currentPort, 0]] : []),
  );
  useEffect(() => {
    setSessions((previous) => {
      const next = new Map([...previous].filter(([port]) => ports.some((item) => item.port === port)));
      if (active && currentPort !== null && !next.has(currentPort)) next.set(currentPort, 0);
      return next.size === previous.size && [...next].every(([port, revision]) => previous.get(port) === revision)
        ? previous
        : next;
    });
  }, [active, currentPort, ports]);

  const currentUrl = useMemo(() => {
    if (currentPort === null) return "";
    return previewUrl({ port: currentPort, baseUrl: window.location.origin });
  }, [currentPort]);

  const handleAddPort = (port: number) => {
    preview.register({ port }, BACKGROUND_CONTEXT).then(
      () => {
        setSelectedPort(port);
        setShowAdd(false);
      },
      (err: unknown) => reportFailure("Could not register port", err),
    );
  };

  const handleClosePort = (port: number) => {
    preview.unregister({ port }, BACKGROUND_CONTEXT).catch((err: unknown) => {
      reportFailure("Could not remove port", err);
    });
  };

  if (!active && ports.length === 0) return null;

  if (ports.length === 0 && !showAdd) {
    return (
      <Empty className="h-full min-h-0 flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GlobeIcon />
          </EmptyMedia>
          <EmptyTitle>No preview available</EmptyTitle>
          <EmptyDescription>
            Start a web server (like Vite or Next.js) in a terminal, or manually specify a port to preview.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <AddPortForm onSubmit={handleAddPort} />
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div
        data-panel-toolbar
        className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-1 border-b px-2 text-xs"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <Tabs
            value={currentPort !== null ? String(currentPort) : ""}
            onValueChange={(val) => setSelectedPort(Number.parseInt(val, 10))}
          >
            <TabsList variant="line" className="h-8">
              {ports.map((item) => (
                <TabsTrigger key={item.port} value={String(item.port)} className="h-7 px-2 text-xs">
                  <span>{item.label ? `${item.port} (${item.label})` : item.port}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <IconAction label="Add port" className="size-7" onClick={() => setShowAdd(!showAdd)}>
            <PlusIcon className="size-3.5" />
          </IconAction>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {currentUrl && (
            <>
              <IconAction
                label="Reload preview"
                className="size-7"
                onClick={() => {
                  if (currentPort !== null) {
                    setSessions((previous) => new Map(previous).set(currentPort, (previous.get(currentPort) ?? 0) + 1));
                  }
                }}
              >
                <RotateCwIcon className="size-3.5" />
              </IconAction>

              <IconAction
                label="Open in new tab"
                className="size-7"
                onClick={() => window.open(currentUrl, "_blank", "noopener,noreferrer")}
              >
                <ExternalLinkIcon className="size-3.5" />
              </IconAction>

              {currentPort !== null && (
                <IconAction
                  label={`Close port ${currentPort}`}
                  className="size-7"
                  onClick={() => handleClosePort(currentPort)}
                  tooltip="Close preview"
                >
                  <XIcon className="size-3.5" />
                </IconAction>
              )}
            </>
          )}
        </div>
      </div>

      {showAdd && <AddPortForm compact onSubmit={handleAddPort} onCancel={() => setShowAdd(false)} />}

      <div className="relative min-h-0 flex-1 bg-background">
        {ports
          .filter((item) => sessions.has(item.port))
          .map((item) => (
            <div key={item.port} hidden={item.port !== currentPort} className="h-full">
              <iframe
                key={sessions.get(item.port)}
                src={previewUrl({ port: item.port, baseUrl: window.location.origin })}
                title={`Preview port ${item.port}`}
                className="h-full w-full border-0"
                sandbox={PREVIEW_SANDBOX_TOKENS.join(" ")}
              />
            </div>
          ))}
        {!currentUrl && (
          <Empty className="h-full">
            <EmptyTitle>No port selected</EmptyTitle>
          </Empty>
        )}
      </div>
    </div>
  );
}
