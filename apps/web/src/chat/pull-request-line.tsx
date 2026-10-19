import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { GitPullRequest } from "lucide-react";
import { buttonVariants } from "@/components/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { useRefreshOnRun } from "@/hooks/use-refresh-on-run.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";

/**
 * The project's current branch's pull request, as pi's `branch-pr-widget` extension shows it: `#33: <url>`, and
 * nothing at all when the branch has none. It sits above the message box, among the things that are not always there.
 * The server reads it with `gh pr view`; a page reads the project again when it opens and after each run.
 */
export function PullRequestLine({ workspaceId, active }: { workspaceId: number | undefined; active?: boolean }) {
  const { repository } = useConnected();
  const state = useReplicatedState(repository.state);

  // Read when the project shown changes, and again after each run.
  useRefreshOnRun(workspaceId, active, (shown) => repository.refresh(shown, BACKGROUND_CONTEXT));

  const pull = workspaceId === undefined ? undefined : state?.projects[workspaceId];
  if (pull === undefined) return null;
  return (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger
          render={<a href={pull.url} target="_blank" rel="noreferrer" />}
          className={buttonVariants({ variant: "link", size: "xs" })}
        >
          <GitPullRequest aria-hidden="true" />
          PR #{pull.number}
        </TooltipTrigger>
        <TooltipContent>{pull.url}</TooltipContent>
      </Tooltip>
    </div>
  );
}
