import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationSummary } from "@tandem/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { useCommand } from "@/hooks/use-command.ts";
import { useConnected } from "@/rpc/connection.tsx";

export function DeleteConversationDialog({
  summary,
  open,
  onOpenChange,
}: {
  summary: ConversationSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { conversations } = useConnected();
  // A page about the conversation leaves by itself: the conversation is no longer there.
  const removal = useCommand({ failure: "Could not delete the conversation" });
  const busy = removal.pending;

  const remove = async () => {
    if (await removal.run(() => conversations.remove(summary.id, BACKGROUND_CONTEXT))) onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete &ldquo;{summary.title}&rdquo;? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void remove();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
