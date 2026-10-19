import { BOOTSTRAP_PATH, PAIR_PATH } from "@tandem/contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCommand } from "@/hooks/use-command.ts";

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

/** A full load, not a navigation: what the page held of a session that has not begun, or has ended, goes with it. */
const enterTandem = (): void => window.location.replace("/");

export function PairScreen({ initialCode, onPaired = enterTandem }: { initialCode?: string; onPaired?: () => void }) {
  const [code, setCode] = useState(initialCode ?? "");
  const pairing = useCommand();
  const { run } = pairing;
  // Once paired the page is on its way out, and pairing again would make another device.
  const [paired, setPaired] = useState(false);
  const failure = pairing.error;
  // A link pairs by itself, so the form is not offered until that has failed.
  const busy = pairing.pending || paired || (initialCode !== undefined && failure === null);
  const started = useRef(false);

  const pair = useCallback(
    (work: () => Promise<void>) =>
      run(async () => {
        await work();
        setPaired(true);
        onPaired();
      }),
    [run, onPaired],
  );

  useEffect(() => {
    if (initialCode === undefined || started.current) return;
    started.current = true;
    void pair(async () => {
      // Reopening an already paired browser must not create another device each time.
      const existing = await fetch(BOOTSTRAP_PATH);
      if (existing.status === 401) await redeemCode(initialCode);
      else if (!existing.ok) throw new Error(`Cannot check this device (status ${existing.status})`);
    });
  }, [initialCode, pair]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!busy) void pair(() => redeemCode(code));
  };
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle role="heading" aria-level={1}>
            Pair this device
          </CardTitle>
          <CardDescription>
            On the computer running Tandem, run <code>bun run service pair</code> and open the printed link. You can
            also choose Add device on a paired browser, or enter a recovery code from your password manager.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field data-invalid={failure !== null}>
              <FieldLabel htmlFor="pair-code">Pairing or recovery code</FieldLabel>
              <Input
                id="pair-code"
                autoComplete="off"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={busy}
                required
              />
              {failure !== null && <FieldError>{failure}</FieldError>}
            </Field>
            <Button type="submit" disabled={busy || code.trim() === ""}>
              {busy && <Spinner />}Pair device
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
