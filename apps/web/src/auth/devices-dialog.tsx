import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type PairingCode, SIGN_OUT_PATH } from "@tandem/contracts";
import { MonitorSmartphoneIcon } from "lucide-react";
import QRCode from "qrcode";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";

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
  const [renaming, setRenaming] = useState<string>();
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    try {
      await action();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const regenerate = async (): Promise<void> => {
    setRecovery(await devices.regenerateRecoveryCodes(BACKGROUND_CONTEXT));
  };
  /** Renaming keeps the typed name and the reason it failed in the row, until it succeeds. */
  const rename = async (id: string): Promise<void> => {
    const name = draft.trim();
    await run(async () => {
      await devices.rename(id, name, BACKGROUND_CONTEXT);
      setRenaming(undefined);
    });
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
              <div key={device.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {renaming === device.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`Name of ${device.name}`}
                        autoFocus
                        value={draft}
                        disabled={busy}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void rename(device.id);
                          if (event.key === "Escape") setRenaming(undefined);
                        }}
                      />
                      <Button size="sm" disabled={busy || draft.trim() === ""} onClick={() => void rename(device.id)}>
                        Save
                      </Button>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => setRenaming(undefined)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <MonitorSmartphoneIcon className="size-4" />
                      <span>{device.name}</span>
                      {device.id === deviceId && <Badge variant="secondary">This device</Badge>}
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground">
                    Last active {new Date(device.lastSeenAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setFailure(undefined);
                      setDraft(device.name);
                      setRenaming(device.id);
                    }}
                  >
                    Rename
                  </Button>
                  {/* Removing this device is signing out: it also clears the cookie this browser holds. */}
                  {device.id !== deviceId && (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        setConfirmation({
                          title: "Revoke this device?",
                          description: "Its active connections will be closed immediately. It will need to pair again.",
                          action: () => devices.revoke(device.id, BACKGROUND_CONTEXT),
                        })
                      }
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
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
            {pair !== undefined && <PairingLink pair={pair} />}
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">Recovery codes</h3>
              <p className="text-sm text-muted-foreground">
                {remaining} codes remaining. Each code pairs one device once.
              </p>
              {remaining > 0 && (
                <p className="text-sm text-muted-foreground">
                  Replacing them makes every code you have saved stop working.
                </p>
              )}
              <Button
                variant={remaining === 0 ? "default" : "destructive"}
                disabled={busy}
                onClick={() => {
                  if (remaining === 0) void run(regenerate);
                  else
                    setConfirmation({
                      title: "Replace recovery codes?",
                      description: "All existing recovery codes will stop working.",
                      action: regenerate,
                    });
                }}
              >
                {remaining === 0 ? "Generate recovery codes" : "Replace recovery codes"}
              </Button>
              {recovery !== undefined && (
                <>
                  <Alert>
                    <AlertTitle>Save these codes now</AlertTitle>
                    <AlertDescription>They are shown only once. Store them in your password manager.</AlertDescription>
                  </Alert>
                  <pre className="overflow-x-auto text-sm">{recovery.join("\n")}</pre>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void run(() => navigator.clipboard.writeText(recovery.join("\n")));
                    }}
                  >
                    Copy recovery codes
                  </Button>
                </>
              )}
            </div>
            {failure !== undefined && <FieldError>{failure}</FieldError>}
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

function PairingLink({ pair }: { pair: PairingCode }) {
  const [qr, setQr] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const connected = useConnected() as { publicAccess?: { state: Parameters<typeof useReplicatedState>[0] } };
  const publicAccessState = useReplicatedState(connected.publicAccess?.state) as { publicUrl?: string } | undefined;
  const activeOrigin = pair.publicUrl ?? publicAccessState?.publicUrl ?? window.location.origin;
  const url = new URL("/pair", activeOrigin);
  url.hash = pair.code;
  const href = url.href;
  useEffect(() => {
    let cancelled = false;
    setQr(undefined);
    void QRCode.toDataURL(href, { width: 240, margin: 2 }).then(
      (value) => {
        if (!cancelled) setQr(value);
      },
      (error: unknown) => {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [href]);
  return (
    <div className="flex flex-col gap-2">
      {qr !== undefined && <img src={qr} alt="Scan to pair another device" className="size-60 self-center" />}
      <Input aria-label="Pairing link" readOnly value={href} />
      <p className="text-sm text-muted-foreground">
        Expires {new Date(pair.expiresAt).toLocaleTimeString()}. Anyone with this link can control Tandem.
      </p>
      {pair.publicUrl === undefined && publicAccessState?.publicUrl === undefined && (
        <p className="text-sm text-muted-foreground">
          This address is local. Configure public access before pairing a remote device.
        </p>
      )}
      {failure !== undefined && <FieldError>{failure}</FieldError>}
    </div>
  );
}
