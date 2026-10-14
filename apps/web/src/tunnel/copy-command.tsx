import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function CopyCommand({ command }: { command: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }
  return (
    <div className="min-w-0 space-y-1">
      <Card size="sm">
        <CardContent className="flex min-w-0 items-start gap-3">
          <pre className="min-w-0 flex-1 whitespace-pre-wrap py-1 font-mono text-sm [overflow-wrap:anywhere]">
            <code>{command}</code>
          </pre>
          <Button type="button" variant="ghost" size="sm" aria-label={`Copy ${command}`} onClick={() => void copy()}>
            {status === "copied" ? <CheckIcon /> : <CopyIcon />}
            {status === "copied" ? "Copied" : "Copy"}
          </Button>
        </CardContent>
      </Card>
      <p role="status" className="text-xs text-muted-foreground">
        {status === "failed"
          ? "Could not copy. Select the command and copy it manually."
          : status === "copied"
            ? "Copied to clipboard."
            : null}
      </p>
    </div>
  );
}
