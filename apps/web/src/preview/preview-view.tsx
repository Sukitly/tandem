import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { previewPath } from "@tandem/contracts";
import { ExternalLinkIcon, GlobeIcon, PlusIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
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
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [manualPort, setManualPort] = useState("");
  const inputId = useId();

  const currentPort = ports.find((p) => p.port === selectedPort)?.port ?? ports[0]?.port ?? null;

  const currentUrl = useMemo(() => {
    if (currentPort === null) return "";
    return `${window.location.origin}${previewPath(currentPort)}`;
  }, [currentPort]);

  const handleAddPort = (e: React.FormEvent) => {
    e.preventDefault();
    const port = Number.parseInt(manualPort.trim(), 10);
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
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-2 text-xs">
        <div className="flex items-center gap-1 overflow-x-auto">
          <Tabs
            value={currentPort !== null ? String(currentPort) : ""}
            onValueChange={(val) => setSelectedPort(Number.parseInt(val, 10))}
          >
            <TabsList variant="line" className="h-8">
              {ports.map((item) => (
                <TabsTrigger key={item.port} value={String(item.port)} className="group h-7 px-2 text-xs">
                  <span>{item.label ? `${item.port} (${item.label})` : item.port}</span>
                  <button
                    type="button"
                    aria-label={`Close port ${item.port}`}
                    className="ml-1 rounded-sm p-0.5 opacity-60 hover:bg-muted hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClosePort(item.port);
                    }}
                  >
                    <XIcon className="size-3" />
                  </button>
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
                />
              }
            >
              <PlusIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Add port</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1">
          {currentUrl && (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Reload preview"
                      onClick={() => setRefreshKey((k) => k + 1)}
                      className="size-7"
                    />
                  }
                >
                  <RotateCwIcon className="size-3.5" />
                </TooltipTrigger>
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
                    />
                  }
                >
                  <ExternalLinkIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Open in new tab</TooltipContent>
              </Tooltip>
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
        {currentUrl ? (
          <iframe
            key={`${currentUrl}-${refreshKey}`}
            src={currentUrl}
            title={`Preview port ${currentPort}`}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        ) : (
          <Empty className="h-full">
            <EmptyTitle>No port selected</EmptyTitle>
          </Empty>
        )}
      </div>
    </div>
  );
}
