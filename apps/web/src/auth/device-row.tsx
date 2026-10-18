import type { DeviceSummary } from "@tandem/contracts";
import { MonitorSmartphoneIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useCompositionGuard } from "@/hooks/use-composition-guard.ts";

export function DeviceRow({
  device,
  isCurrentDevice,
  busy,
  onRename,
  onRevoke,
}: {
  device: DeviceSummary;
  isCurrentDevice: boolean;
  busy: boolean;
  onRename(name: string): Promise<boolean>;
  onRevoke(): void;
}) {
  const ime = useCompositionGuard();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(device.name);

  const save = async () => {
    if (busy || ime.active()) return;
    const name = draft.trim();
    if (name === "") return;
    const ok = await onRename(name);
    if (ok) setRenaming(false);
  };

  return (
    <div className="flex flex-col items-stretch justify-between gap-2 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        {renaming ? (
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Name of ${device.name}`}
              autoFocus
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onCompositionStart={ime.onCompositionStart}
              onCompositionEnd={ime.onCompositionEnd}
              onKeyDown={(event) => {
                if (ime.owns(event)) return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setRenaming(false);
                }
              }}
            />
            <Button size="sm" disabled={busy || draft.trim() === ""} onClick={() => void save()}>
              Save
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <MonitorSmartphoneIcon className="size-4" />
            <span className="min-w-0 truncate" title={device.name}>
              {device.name}
            </span>
            {isCurrentDevice && <Badge variant="secondary">This device</Badge>}
          </div>
        )}
        <p className="text-sm text-muted-foreground">Last active {new Date(device.lastSeenAt).toLocaleString()}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            setDraft(device.name);
            setRenaming(true);
          }}
        >
          Rename
        </Button>
        {!isCurrentDevice && (
          <Button variant="destructive" size="sm" disabled={busy} onClick={onRevoke}>
            Revoke
          </Button>
        )}
      </div>
    </div>
  );
}
