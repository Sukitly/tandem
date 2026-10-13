import { BOOTSTRAP_PATH, PAIR_PATH } from "@tandem/contracts";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export async function redeemCode(code: string): Promise<void> {
  const response = await fetch(PAIR_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: string };
    throw new Error(body.error ?? `Pairing failed (status ${response.status})`);
  }
}

/** A fragment never reaches the HTTP server or tunnel's URL logs. Consume it before any asynchronous work. */
export function takePairingCode(): string | undefined {
  if (window.location.pathname !== "/pair") return undefined;
  const code = window.location.hash.slice(1);
  window.history.replaceState(window.history.state, "", "/pair");
  return code || undefined;
}

const enterTandem = (): void => window.location.replace("/");

export function PairScreen({ initialCode, onPaired = enterTandem }: { initialCode?: string; onPaired?: () => void }) {
  const [code, setCode] = useState(initialCode ?? "");
  const [busy, setBusy] = useState(initialCode !== undefined);
  const [failure, setFailure] = useState<string>();
  const started = useRef(false);
  useEffect(() => {
    if (initialCode === undefined || started.current) return;
    started.current = true;
    void (async () => {
      try {
        // Reopening an already paired browser must not create another device each time.
        const existing = await fetch(BOOTSTRAP_PATH);
        if (existing.status === 401) await redeemCode(initialCode);
        else if (!existing.ok) throw new Error(`Cannot check this device (status ${existing.status})`);
        onPaired();
      } catch (error) {
        setFailure(error instanceof Error ? error.message : String(error));
        setBusy(false);
      }
    })();
  }, [initialCode, onPaired]);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      await redeemCode(code);
      onPaired();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Pair this device</CardTitle>
          <CardDescription>
            Open the link printed by Tandem, or choose Add device on a paired browser. Without a paired device, enter a
            recovery code from your password manager.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field data-invalid={failure !== undefined}>
              <FieldLabel htmlFor="pair-code">Pairing or recovery code</FieldLabel>
              <Input
                id="pair-code"
                autoComplete="off"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={busy}
                required
              />
              {failure !== undefined && <FieldError>{failure}</FieldError>}
            </Field>
            <Button type="submit" disabled={busy || code.trim() === ""}>
              {busy && <Spinner />}Pair device
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
