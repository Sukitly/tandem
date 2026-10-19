import { Settings2Icon } from "lucide-react";
import type { KeyboardMode, SendMode } from "@/app/user-preferences.ts";
import { PromptInputActionButton } from "@/components/ai-elements/prompt-input.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type { KeyboardMode, SendMode };

export function ComposerOptions({
  mobile,
  keyboard,
  onKeyboard,
  mode,
  onMode,
}: {
  mobile: boolean;
  keyboard: KeyboardMode;
  onKeyboard(mode: KeyboardMode): void;
  mode: SendMode;
  onMode(mode: SendMode): void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<PromptInputActionButton type="button" aria-label="Composer options" />}>
        <Settings2Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {mobile ? (
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
        ) : (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Keyboard shortcuts</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={keyboard} onValueChange={(value) => onKeyboard(value as KeyboardMode)}>
              <DropdownMenuRadioItem value="platform" closeOnClick>
                Platform defaults
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="emacs" closeOnClick>
                Emacs editing
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
