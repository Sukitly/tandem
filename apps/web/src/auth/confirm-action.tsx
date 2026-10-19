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

/** What a person is asked to confirm before it is done, and what is done when they do. */
export type Confirmation = { title: string; description: string; action(): Promise<void> };

/** Asks whether to go on with an action that cannot be taken back; shown while there is something to confirm. */
export function ConfirmAction({
  confirmation,
  busy,
  onCancel,
  onConfirm,
}: {
  confirmation: Confirmation | undefined;
  busy: boolean;
  onCancel(): void;
  onConfirm(action: () => Promise<void>): void;
}) {
  return (
    <AlertDialog
      open={confirmation !== undefined}
      onOpenChange={(shown) => {
        if (!shown) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={() => {
              if (confirmation !== undefined) onConfirm(confirmation.action);
            }}
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
