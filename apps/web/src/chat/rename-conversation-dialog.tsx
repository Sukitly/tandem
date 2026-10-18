import { type ConversationSummary, MAX_CONVERSATION_TITLE_LENGTH } from "@tandem/contracts";
import { useEffect, useState } from "react";
import { useWorkbench } from "@/app/workbench.tsx";
import { ResponsiveDialogContent as DialogContent } from "@/components/responsive-dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useCompositionGuard } from "@/hooks/use-composition-guard.ts";

export function RenameConversationDialog({
  summary,
  open,
  onOpenChange,
}: {
  summary: ConversationSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { renameConversation } = useWorkbench((state) => ({ renameConversation: state.renameConversation }));
  const ime = useCompositionGuard();
  const [title, setTitle] = useState(summary.title);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setTitle(summary.title);
  }, [open, summary.title]);

  const save = async () => {
    if (busy || ime.active()) return;
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
          <DialogDescription>Choose a title for this conversation.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="grid gap-4"
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_CONVERSATION_TITLE_LENGTH}
            autoFocus
            disabled={busy}
            aria-label="Conversation title"
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(event) => {
              if (ime.owns(event)) return;
              if (event.key === "Enter") {
                event.preventDefault();
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
