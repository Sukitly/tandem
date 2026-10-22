import { Settings2Icon } from "lucide-react";
import type { SendMode } from "@/app/user-preferences.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton } from "@/components/ui/input-group.tsx";

export type { SendMode };

/**
 * How a message is sent while the agent works. Only narrow layouts have it: a phone has no Alt+Enter, so it chooses
 * once between steering the turn and queueing a follow-up; on a desktop, Enter steers and Alt+Enter queues.
 */
export function ComposerOptions({ mode, onMode }: { mode: SendMode; onMode(mode: SendMode): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<InputGroupButton size="icon-sm" aria-label="Composer options" />}>
        <Settings2Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>While the agent is running</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={mode} onValueChange={(value) => onMode(value as SendMode)}>
            <DropdownMenuRadioItem value="steer" closeOnClick>
              Steer current turn
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="followUp" closeOnClick>
              Queue follow-up
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
