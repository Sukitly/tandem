import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { PREVIEW_SANDBOX_TOKENS, previewUrl } from "@tandem/contracts";
import { ExternalLinkIcon, GlobeIcon, PlusIcon, RotateCwIcon, XIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { IconAction } from "@/components/icon-action.tsx";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty.tsx";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { reportFailure } from "@/lib/errors.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { AddPortForm } from "./add-port-form.tsx";
import { usePreviewSessions } from "./preview-sessions.ts";

export function PreviewView({ active = true }: { active?: boolean }) {
  const { preview } = useConnected();
  const state = useReplicatedState(preview.state);
  const ports = useMemo(() => state?.ports ?? [], [state?.ports]);
  const [selectedPort, setSelectedPort] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const currentPort = ports.find((p) => p.port === selectedPort)?.port ?? ports[0]?.port ?? null;
  const portNumbers = useMemo(() => ports.map((item) => item.port), [ports]);
  const { sessions, reload } = usePreviewSessions(portNumbers, currentPort, active);

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
      <PreviewToolbar
        ports={ports}
        current={currentPort}
        onSelect={setSelectedPort}
        onToggleAdd={() => setShowAdd(!showAdd)}
        onReload={reload}
        onClose={handleClosePort}
      />
      {showAdd && <AddPortForm compact onSubmit={handleAddPort} onCancel={() => setShowAdd(false)} />}
      <div className="relative min-h-0 flex-1 bg-background">
        {ports
          .filter((item) => sessions.has(item.port))
          .map((item) => (
            <PreviewFrame
              key={item.port}
              port={item.port}
              revision={sessions.get(item.port) ?? 0}
              hidden={item.port !== currentPort}
            />
          ))}
        {currentPort === null && (
          <Empty className="h-full">
            <EmptyTitle>No port selected</EmptyTitle>
          </Empty>
        )}
      </div>
    </div>
  );
}

function PreviewToolbar({
  ports,
  current,
  onSelect,
  onToggleAdd,
  onReload,
  onClose,
}: {
  ports: readonly { port: number; label?: string }[];
  current: number | null;
  onSelect(port: number): void;
  onToggleAdd(): void;
  onReload(port: number): void;
  onClose(port: number): void;
}): ReactNode {
  const currentUrl = current === null ? "" : previewUrl({ port: current, baseUrl: window.location.origin });
  return (
    <div
      data-panel-toolbar
      className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-1 border-b px-2 text-xs"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <Tabs
          value={current !== null ? String(current) : ""}
          onValueChange={(value) => onSelect(Number.parseInt(value, 10))}
        >
          <TabsList variant="line" className="h-8">
            {ports.map((item) => (
              <TabsTrigger key={item.port} value={String(item.port)} className="h-7 px-2 text-xs">
                <span>{item.label ? `${item.port} (${item.label})` : item.port}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <IconAction label="Add port" className="size-7" onClick={onToggleAdd}>
          <PlusIcon className="size-3.5" />
        </IconAction>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {current !== null && (
          <>
            <IconAction label="Reload preview" className="size-7" onClick={() => onReload(current)}>
              <RotateCwIcon className="size-3.5" />
            </IconAction>

            <IconAction
              label="Open in new tab"
              className="size-7"
              onClick={() => window.open(currentUrl, "_blank", "noopener,noreferrer")}
            >
              <ExternalLinkIcon className="size-3.5" />
            </IconAction>

            <IconAction
              label={`Close port ${current}`}
              className="size-7"
              onClick={() => onClose(current)}
              tooltip="Close preview"
            >
              <XIcon className="size-3.5" />
            </IconAction>
          </>
        )}
      </div>
    </div>
  );
}

/** A port's page, kept while another is shown; a new `revision` draws it again from the start. */
function PreviewFrame({ port, revision, hidden }: { port: number; revision: number; hidden: boolean }) {
  return (
    <div hidden={hidden} className="h-full">
      <iframe
        key={revision}
        src={previewUrl({ port, baseUrl: window.location.origin })}
        title={`Preview port ${port}`}
        className="h-full w-full border-0"
        sandbox={PREVIEW_SANDBOX_TOKENS.join(" ")}
      />
    </div>
  );
}
