import { useState } from "react";
import { ResponsiveDialogContent as DialogContent } from "@/components/responsive-dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";

/** Asks, once the last recovery code is gone, to save new ones: they pair a device when no paired one is at hand. */
export function RecoveryReminder({ onManage }: { onManage(): void }) {
  const { devices } = useConnected();
  const state = useReplicatedState(devices.state);
  const [dismissed, setDismissed] = useState(false);
  if (state?.recoveryCodesRemaining !== 0 || dismissed) return null;
  return (
    <Dialog open onOpenChange={() => setDismissed(true)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save recovery codes</DialogTitle>
          <DialogDescription>
            Recovery codes let you pair a new device when no paired device is available. Keep them in your password
            manager, not on this machine alone.
          </DialogDescription>
        </DialogHeader>
        <Button
          onClick={() => {
            setDismissed(true);
            onManage();
          }}
        >
          Manage devices and recovery codes
        </Button>
      </DialogContent>
    </Dialog>
  );
}
