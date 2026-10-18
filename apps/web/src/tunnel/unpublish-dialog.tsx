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
import { Spinner } from "@/components/ui/spinner.tsx";

export function UnpublishDialog({
  open,
  stopping,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  stopping: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop publishing?</AlertDialogTitle>
          <AlertDialogDescription>
            This machine stops answering at that address. The tunnel and its DNS record stay in Cloudflare, so
            publishing again takes one step.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={stopping}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={stopping}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {stopping && <Spinner />}
            {stopping ? "Stopping…" : "Stop publishing"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
