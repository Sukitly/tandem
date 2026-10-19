import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type PairingCode, SIGN_OUT_PATH } from "@tandem/contracts";
import { createContext, type ReactNode, useContext, useState } from "react";
import { ResponsiveDialogContent as DialogContent } from "@/components/responsive-dialog.tsx";
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
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { FieldError } from "@/components/ui/field.tsx";
import { useCommand } from "@/hooks/use-command.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { DevicePairing } from "./device-pairing.tsx";
import { DeviceRow } from "./device-row.tsx";
import { RecoveryCodesSection } from "./recovery-codes-section.tsx";

const DevicesDialogContext = createContext<{ open(): void }>({ open: () => {} });
export function useDevicesDialog(): { open(): void } {
  return useContext(DevicesDialogContext);
}

export function DevicesDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { devices } = useConnected();
  const state = useReplicatedState(devices.state);
  const [dismissed, setDismissed] = useState(false);
  return (
    <DevicesDialogContext.Provider value={{ open: () => setOpen(true) }}>
      {children}
      {state?.recoveryCodesRemaining === 0 && !dismissed && (
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
                setOpen(true);
              }}
            >
              Manage devices and recovery codes
            </Button>
          </DialogContent>
        </Dialog>
      )}
      {open && <DevicesDialog open={open} onOpenChange={setOpen} />}
    </DevicesDialogContext.Provider>
  );
}

type Confirmation = { title: string; description: string; action(): Promise<void> };

function DevicesDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { devices, deviceId } = useConnected();
  const state = useReplicatedState(devices.state);
  const [pair, setPair] = useState<PairingCode>();
  const [recovery, setRecovery] = useState<string[]>();
  const remaining = state?.recoveryCodesRemaining ?? 0;
  const deviceList = state?.devices ?? [];
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const command = useCommand();
  const { run } = command;
  const busy = command.pending;
  const failure = command.error;

  const regenerate = async (): Promise<void> => {
    const codes = await devices.regenerateRecoveryCodes(BACKGROUND_CONTEXT);
    setRecovery(codes);
  };

  const onRenameDevice = async (id: string, name: string): Promise<boolean> => {
    return run(() => devices.rename(id, name, BACKGROUND_CONTEXT));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Devices</DialogTitle>
            <DialogDescription>
              Every paired device can run agents and terminals with this machine's permissions.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {deviceList.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                isCurrentDevice={device.id === deviceId}
                busy={busy}
                onRename={(name) => onRenameDevice(device.id, name)}
                onRevoke={() =>
                  setConfirmation({
                    title: "Revoke this device?",
                    description: "Its active connections will be closed immediately. It will need to pair again.",
                    action: () => devices.revoke(device.id, BACKGROUND_CONTEXT),
                  })
                }
              />
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => {
                  void run(async () => setPair(await devices.addDevice(BACKGROUND_CONTEXT)));
                }}
              >
                Add device
              </Button>
              {deviceId !== undefined && (
                <>
                  {deviceList.length > 1 && (
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() =>
                        setConfirmation({
                          title: "Revoke all other devices?",
                          description: "Only this browser will remain paired.",
                          action: () => devices.revokeOthers(deviceId, BACKGROUND_CONTEXT),
                        })
                      }
                    >
                      Revoke other devices
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      setConfirmation({
                        title: "Sign out?",
                        description: "You will need a pairing link or recovery code to sign in again.",
                        action: async () => {
                          const response = await fetch(SIGN_OUT_PATH, { method: "POST" });
                          if (!response.ok) throw new Error(`Sign out failed (status ${response.status})`);
                          window.location.replace("/");
                        },
                      })
                    }
                  >
                    Sign out
                  </Button>
                </>
              )}
            </div>
            {pair !== undefined && <DevicePairing pair={pair} />}
            <RecoveryCodesSection
              remaining={remaining}
              busy={busy}
              recovery={recovery}
              onGenerate={() => {
                if (remaining === 0) void run(regenerate);
                else
                  setConfirmation({
                    title: "Replace recovery codes?",
                    description: "All existing recovery codes will stop working.",
                    action: regenerate,
                  });
              }}
              onCopy={() => {
                if (recovery !== undefined) {
                  void run(() => navigator.clipboard.writeText(recovery.join("\n")));
                }
              }}
            />
            {failure !== null && <FieldError>{failure}</FieldError>}
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirmation !== undefined}
        onOpenChange={(shown) => {
          if (!shown) setConfirmation(undefined);
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
                const action = confirmation?.action;
                setConfirmation(undefined);
                if (action !== undefined) void run(action);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
