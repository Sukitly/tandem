import type { TerminalSummary } from "@tandem/contracts";
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

export function CloseTerminalDialog({
  terminal,
  onClose,
  onCancel,
}: {
  terminal: TerminalSummary | null;
  onClose(summary: TerminalSummary): void;
  onCancel(): void;
}) {
  return (
    <AlertDialog open={terminal !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close {terminal?.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its shell is still running. Closing the terminal ends the shell and what runs in it, for every page.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (terminal !== null) onClose(terminal);
            }}
          >
            Close
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
