import type { PairingCode } from "@tandem/contracts";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { FieldError } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";

export function DevicePairing({ pair }: { pair: PairingCode }) {
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
