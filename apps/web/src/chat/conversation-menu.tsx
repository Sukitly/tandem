import type { ConversationSummary } from "@tandem/contracts";
import { EllipsisIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { DeleteConversationDialog } from "./delete-conversation-dialog.tsx";
import { RenameConversationDialog } from "./rename-conversation-dialog.tsx";

export { DeleteConversationDialog } from "./delete-conversation-dialog.tsx";
export { RenameConversationDialog } from "./rename-conversation-dialog.tsx";

export interface ConversationMenuProps {
  summary: ConversationSummary;
  /** Custom trigger element. When omitted, defaults to a ghost ellipsis icon button. */
  trigger?: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}

/** Action menu for a conversation offering rename and delete operations. */
export function ConversationMenu({ summary, trigger, side = "bottom", align = "start" }: ConversationMenuProps) {
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const defaultTrigger = (
    <Button
      variant="ghost"
      size="icon-xs"
      className="text-muted-foreground hover:text-foreground"
      aria-label={`Actions for ${summary.title}`}
      title="Conversation actions"
    >
      <EllipsisIcon />
    </Button>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger ?? defaultTrigger} />
        <DropdownMenuContent side={side} align={align} className="w-40">
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameConversationDialog summary={summary} open={renaming} onOpenChange={setRenaming} />
      <DeleteConversationDialog summary={summary} open={deleting} onOpenChange={setDeleting} />
    </>
  );
}
