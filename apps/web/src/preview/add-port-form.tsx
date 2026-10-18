import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";

export function AddPortForm({
  onSubmit,
  onCancel,
  compact = false,
}: {
  onSubmit(port: number): void;
  onCancel?(): void;
  compact?: boolean;
}) {
  const [manualPort, setManualPort] = useState("");
  const inputId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const port = Number(manualPort.trim());
    if (Number.isInteger(port) && port >= 1 && port <= 65535) {
      onSubmit(port);
      setManualPort("");
    }
  };

  if (compact) {
    return (
      <form onSubmit={submit} className="flex items-center gap-2 border-b bg-muted/40 p-2 text-xs">
        <Input
          id={inputId}
          type="number"
          min="1"
          max="65535"
          placeholder="Port (e.g. 5173)"
          value={manualPort}
          onChange={(e) => setManualPort(e.target.value)}
          className="h-7 w-32 text-xs"
          autoFocus
        />
        <Button type="submit" size="xs" className="h-7 px-2">
          Add
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="xs" onClick={onCancel} className="h-7 px-2">
            Cancel
          </Button>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-xs items-center gap-2">
      <Input
        id={inputId}
        type="number"
        min="1"
        max="65535"
        placeholder="e.g. 3000, 5173"
        value={manualPort}
        onChange={(e) => setManualPort(e.target.value)}
        className="h-8 text-xs"
      />
      <Button type="submit" size="sm" className="h-8 px-3 text-xs">
        Add port
      </Button>
    </form>
  );
}
