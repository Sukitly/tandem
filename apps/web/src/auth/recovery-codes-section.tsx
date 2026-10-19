import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";

export function RecoveryCodesSection({
  remaining,
  busy,
  recovery,
  onGenerate,
  onCopy,
}: {
  remaining: number;
  busy: boolean;
  recovery: string[] | undefined;
  onGenerate(): void;
  onCopy(): void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">Recovery codes</h3>
      <p className="text-sm text-muted-foreground">{remaining} codes remaining. Each code pairs one device once.</p>
      {remaining > 0 && (
        <p className="text-sm text-muted-foreground">Replacing them makes every code you have saved stop working.</p>
      )}
      <Button variant={remaining === 0 ? "default" : "destructive"} disabled={busy} onClick={onGenerate}>
        {remaining === 0 ? "Generate recovery codes" : "Replace recovery codes"}
      </Button>
      {recovery !== undefined && (
        <>
          <Alert>
            <AlertTitle>Save these codes now</AlertTitle>
            <AlertDescription>They are shown only once. Store them in your password manager.</AlertDescription>
          </Alert>
          <pre className="overflow-x-auto text-sm">{recovery.join("\n")}</pre>
          <Button variant="outline" onClick={onCopy}>
            Copy recovery codes
          </Button>
        </>
      )}
    </div>
  );
}
