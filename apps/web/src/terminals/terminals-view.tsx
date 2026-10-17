import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { exitLabel, MAX_TERMINALS_PER_PROJECT, type TerminalSummary } from "@tandem/contracts";
import { PlusIcon, SquareTerminalIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useWorkbench } from "@/app/workbench.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { TerminalView } from "./terminal-view.tsx";

/**
 * The terminals of a project, one tab each. They are the server's: every page shows the same ones, and they keep
 * running when the page goes. A shell that ended stays, with its exit code, until it is closed.
 */
export function TerminalsView({ workspaceId, active }: { workspaceId: number; active: boolean }) {
  const { terminals } = useConnected();
  const { reportFailure } = useWorkbench();
  const all = useReplicatedState(terminals.state)?.terminals;
  const list = (all ?? []).filter((summary) => summary.workspaceId === workspaceId);
  const [selected, setSelected] = useState<string | null>(null);
  const [closing, setClosing] = useState<TerminalSummary | null>(null);
  const [creating, setCreating] = useState(false);
  // The one chosen, once the list has it: a terminal just opened may reach the list after `create` returns. Until
  // then, or once it is closed, the newest one.
  const current = list.find((summary) => summary.id === selected) ?? list.at(-1);

  const create = (): void => {
    if (creating) return;
    setCreating(true);
    terminals.create({ workspaceId }, BACKGROUND_CONTEXT).then(
      (id) => {
        setCreating(false);
        setSelected(id);
      },
      (error: unknown) => {
        setCreating(false);
        reportFailure("Could not open a terminal", error);
      },
    );
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
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="New terminal"
                disabled={creating || list.length >= MAX_TERMINALS_PER_PROJECT}
                onClick={create}
              />
            }
          >
            <PlusIcon />
          </TooltipTrigger>
          <TooltipContent>New terminal</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Close ${current.title}`}
                className="ml-auto"
                // A running shell is ended by closing: that is asked first. One that ended has nothing left to lose.
                onClick={() => (current.exit === undefined ? setClosing(current) : close(current))}
              />
            }
          >
            <XIcon />
          </TooltipTrigger>
          <TooltipContent>Close {current.title}</TooltipContent>
        </Tooltip>
      </div>
      {list.map((summary) => (
        // Kept mounted: a hidden terminal keeps its screen and its connection, as a terminal app's tabs do.
        <TabsContent key={summary.id} value={summary.id} keepMounted className="min-h-0">
          <TerminalView
            id={summary.id}
            active={active && summary.id === current.id}
            ended={summary.exit !== undefined}
          />
        </TabsContent>
      ))}
      <AlertDialog open={closing !== null} onOpenChange={(open) => !open && setClosing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close {closing?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its shell is still running. Closing the terminal ends the shell and what runs in it, for every page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (closing !== null) close(closing);
                setClosing(null);
              }}
            >
              Close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}
