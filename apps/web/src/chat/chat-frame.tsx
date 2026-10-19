import type { ConversationSummary } from "@tandem/contracts";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SidebarToggle } from "@/app/sidebar.tsx";
import { useWorkbench } from "@/app/workbench.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { ConversationMenu } from "./conversation-menu.tsx";

/** A conversation's page: the header with its directory and title, then the content. */
export function ChatFrame({
  cwd,
  title,
  summary,
  children,
}: {
  cwd: string | undefined;
  title: string | undefined;
  summary?: ConversationSummary;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col" aria-label="Conversation">
      <header className="flex h-13 min-w-0 shrink-0 items-center gap-2 border-b px-3">
        <SidebarToggle className="md:hidden" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-muted-foreground">{cwd}</p>
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-sm font-medium">{title}</h1>
            {summary !== undefined && <ConversationMenu summary={summary} />}
          </div>
        </div>
        <FilesToggle />
      </header>
      {children}
    </section>
  );
}

/** Shows or hides the files panel beside the conversation. */
export function FilesToggle() {
  const { filesShown, showFiles } = useWorkbench((state) => ({
    filesShown: state.filesShown,
    showFiles: state.showFiles,
  }));
  const isMobile = useIsMobile();
  const label = filesShown ? "Hide files" : "Show files";

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={filesShown}
      onClick={() => showFiles(!filesShown)}
    >
      {isMobile ? (
        filesShown ? (
          <ChevronDownIcon />
        ) : (
          <ChevronUpIcon />
        )
      ) : filesShown ? (
        <ChevronRightIcon />
      ) : (
        <ChevronLeftIcon />
      )}
    </Button>
  );
}

/** Under the transcript: notices and the message box. */
export function ChatFooter({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-3xl shrink-0 grid-cols-[minmax(0,1fr)] gap-2 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:gap-3">
      {children}
    </div>
  );
}
