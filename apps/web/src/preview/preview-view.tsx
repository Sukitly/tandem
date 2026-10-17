import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { PREVIEW_SANDBOX_TOKENS, previewUrl } from "@tandem/contracts";
import { ExternalLinkIcon, GlobeIcon, PlusIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useWorkbench } from "@/app/workbench.tsx";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type Connected, useOptionalConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";

export function PreviewView({ active = true }: { active?: boolean }) {
  const connected = useOptionalConnected();
  if (connected === null) return null;
  return <PreviewPanel connected={connected} active={active} />;
}

function PreviewPanel({ connected, active = true }: { connected: Connected; active?: boolean }) {
  const { preview } = connected;
  const { reportFailure } = useWorkbench();
  const state = useReplicatedState(preview.state);
  const ports = useMemo(() => state?.ports ?? [], [state?.ports]);

  const [selectedPort, setSelectedPort] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [manualPort, setManualPort] = useState("");
  const inputId = useId();

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

  const handleAddPort = (e: React.FormEvent) => {
    e.preventDefault();
    const port = Number(manualPort.trim());
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      reportFailure("Invalid port", new Error("Please enter a valid port number between 1 and 65535"));
      return;
    }
    preview.register({ port }, BACKGROUND_CONTEXT).then(
      () => {
        setSelectedPort(port);
        setManualPort("");
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

  if (!active && ports.length === 0) {
    return null;
  }

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
          <form onSubmit={handleAddPort} className="flex w-full max-w-xs items-center gap-2">
            <Input
              id={inputId}
              type="number"
              min="1"
              max="65535"
              placeholder="e.g. 3000, 5173"
              value={manualPort}
              onChange={(e) => setManualPort(e.target.value)}
              className="h-8 text-xs"
            />
            <Button type="submit" size="sm" className="h-8 px-3 text-xs">
              Add port
            </Button>
          </form>
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

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Add port"
                  onClick={() => setShowAdd(!showAdd)}
                  className="size-7"
                >
                  <PlusIcon className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent>Add port</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {currentUrl && (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Reload preview"
                      onClick={() => {
                        if (currentPort !== null)
                          setSessions((previous) =>
                            new Map(previous).set(currentPort, (previous.get(currentPort) ?? 0) + 1),
                          );
                      }}
                      className="size-7"
                    >
                      <RotateCwIcon className="size-3.5" />
                    </Button>
                  }
                />
                <TooltipContent>Reload</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Open in new tab"
                      onClick={() => window.open(currentUrl, "_blank", "noopener,noreferrer")}
                      className="size-7"
                    >
                      <ExternalLinkIcon className="size-3.5" />
                    </Button>
                  }
                />
                <TooltipContent>Open in new tab</TooltipContent>
              </Tooltip>

              {currentPort !== null && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Close port ${currentPort}`}
                        onClick={() => handleClosePort(currentPort)}
                        className="size-7"
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    }
                  />
                  <TooltipContent>Close preview</TooltipContent>
                </Tooltip>
              )}
            </>
          )}
        </div>
      </div>

      {showAdd && (
        <form onSubmit={handleAddPort} className="flex items-center gap-2 border-b bg-muted/40 p-2 text-xs">
          <Input
            id={inputId}
            type="number"
            min="1"
            max="65535"
            placeholder="Port (e.g. 5173)"
            value={manualPort}
            onChange={(e) => setManualPort(e.target.value)}
            className="h-7 w-32 text-xs"
            autoFocus
          />
          <Button type="submit" size="xs" className="h-7 px-2">
            Add
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={() => setShowAdd(false)} className="h-7 px-2">
            Cancel
          </Button>
        </form>
      )}

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
