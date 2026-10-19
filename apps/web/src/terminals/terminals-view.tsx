import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { exitLabel, MAX_TERMINALS_PER_PROJECT, type TerminalSummary } from "@tandem/contracts";
import { PlusIcon, SquareTerminalIcon, XIcon } from "lucide-react";
import { Suspense, useState } from "react";
import { IconAction } from "@/components/icon-action.tsx";
import { LoadingView } from "@/components/loading-view.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { useCommand } from "@/hooks/use-command.ts";
import { reportFailure } from "@/lib/errors.ts";
import { lazyExport } from "@/lib/lazy-export.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { CloseTerminalDialog } from "./close-terminal-dialog.tsx";

/** A terminal draws with xterm, which is loaded when the first one is drawn. */
const TerminalView = lazyExport(() => import("./terminal-view.tsx"), "TerminalView");

/**
 * The terminals of a project, one tab each. They are the server's: every page shows the same ones, and they keep
 * running when the page goes. A shell that ended stays, with its exit code, until it is closed.
 */
export function TerminalsView({ workspaceId, active }: { workspaceId: number; active: boolean }) {
  const { terminals } = useConnected();
  const all = useReplicatedState(terminals.state)?.terminals;
  const list = (all ?? []).filter((summary) => summary.workspaceId === workspaceId);
  const [selected, setSelected] = useState<string | null>(null);
  const [closing, setClosing] = useState<TerminalSummary | null>(null);
  const creation = useCommand({ failure: "Could not open a terminal" });
  const creating = creation.pending;
  const current = list.find((summary) => summary.id === selected) ?? list.at(-1);

  const create = (): void => {
    void creation.run(async () => setSelected(await terminals.create({ workspaceId }, BACKGROUND_CONTEXT)));
  };

  const close = (summary: TerminalSummary): void => {
    terminals.close(summary.id, BACKGROUND_CONTEXT).catch((error: unknown) => {
      reportFailure("Could not close the terminal", error);
    });
  };

  if (all === undefined) return null;
  if (current === undefined) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SquareTerminalIcon />
          </EmptyMedia>
          <EmptyTitle>No terminal</EmptyTitle>
          <EmptyDescription>
            A shell in the project's directory. It keeps running when you close the page.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={create} disabled={creating}>
            <PlusIcon />
            New terminal
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <Tabs value={current.id} onValueChange={(value) => setSelected(String(value))} className="h-full min-h-0 gap-0">
      <div data-panel-toolbar className="flex min-w-0 shrink-0 items-center gap-1 border-b px-2 py-1">
        <TabsList variant="line" className="min-w-0 overflow-x-auto">
          {list.map((summary) => (
            <TabsTrigger key={summary.id} value={summary.id} className="flex-none">
              {summary.title}
              {summary.exit !== undefined && <Badge variant="outline">{exitLabel(summary.exit)}</Badge>}
            </TabsTrigger>
          ))}
        </TabsList>
        <IconAction
          variant="ghost"
          size="icon-xs"
          label="New terminal"
          disabled={creating || list.length >= MAX_TERMINALS_PER_PROJECT}
          onClick={create}
        >
          <PlusIcon />
        </IconAction>
        <IconAction
          variant="ghost"
          size="icon-xs"
          label={`Close ${current.title}`}
          className="ml-auto"
          onClick={() => (current.exit === undefined ? setClosing(current) : close(current))}
          tooltip={<> Close {current.title} </>}
        >
          <XIcon />
        </IconAction>
      </div>
      {list.map((summary) => (
        <TabsContent key={summary.id} value={summary.id} keepMounted className="min-h-0">
          <Suspense fallback={<LoadingView />}>
            <TerminalView
              id={summary.id}
              active={active && summary.id === current.id}
              ended={summary.exit !== undefined}
            />
          </Suspense>
        </TabsContent>
      ))}
      <CloseTerminalDialog
        terminal={closing}
        onClose={(summary) => {
          close(summary);
          setClosing(null);
        }}
        onCancel={() => setClosing(null)}
      />
    </Tabs>
  );
}
