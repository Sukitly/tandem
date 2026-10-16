import { type ConversationSummary, MAX_CONVERSATION_TITLE_LENGTH } from "@tandem/contracts";
import { useEffect, useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function RenameConversationDialog({
  summary,
  open,
  onOpenChange,
}: {
  summary: ConversationSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { renameConversation } = useWorkbench();
  const [title, setTitle] = useState(summary.title);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setTitle(summary.title);
  }, [open, summary.title]);

  const save = async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CONVERSATION_TITLE_LENGTH) return;
    if (trimmed === summary.title) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    try {
      await renameConversation(summary.id, trimmed);
      onOpenChange(false);
    } catch {
      // Toast reported by workbench
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename conversation</DialogTitle>
          <DialogDescription>Enter a new title for this conversation.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex flex-col gap-4"
        >
          <Input
            aria-label="Conversation title"
            autoFocus
            maxLength={MAX_CONVERSATION_TITLE_LENGTH}
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void save();
              }
            }}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
            <Button
              type="submit"
              disabled={busy || title.trim().length === 0 || title.trim().length > MAX_CONVERSATION_TITLE_LENGTH}
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteConversationDialog({
  summary,
  open,
  onOpenChange,
}: {
  summary: ConversationSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { removeConversation } = useWorkbench();
  const [busy, setBusy] = useState(false);

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await removeConversation(summary.id);
      onOpenChange(false);
    } catch {
      // Toast reported by workbench
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
          <AlertDialogDescription>
            This conversation and its message history will be permanently deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void confirmDelete();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
