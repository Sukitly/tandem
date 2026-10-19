import { FolderPlusIcon, MessageSquareIcon } from "lucide-react";
import { SidebarToggle } from "@/app/sidebar.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty.tsx";

export function EmptyWorkspace({ empty, addProject }: { empty: boolean; addProject(): void }) {
  return (
    <>
      <header className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
        <SidebarToggle />
      </header>
      {empty ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderPlusIcon />
            </EmptyMedia>
            <EmptyTitle role="heading" aria-level={1}>
              Add a project
            </EmptyTitle>
            <EmptyDescription>A project is a directory on this machine. Its conversations work in it.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={addProject}>Add project</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareIcon />
            </EmptyMedia>
            <EmptyTitle role="heading" aria-level={1}>
              No conversation open
            </EmptyTitle>
            <EmptyDescription>Choose a conversation in the sidebar, or start a new one.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </>
  );
}
