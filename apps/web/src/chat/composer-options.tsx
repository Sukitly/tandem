import { Settings2Icon } from "lucide-react";
import { PromptInputActionButton } from "@/components/ai-elements/prompt-input.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { preferences } from "@/lib/preferences.ts";

export type KeyboardMode = "platform" | "emacs";
export type SendMode = "steer" | "followUp";
export const KEYBOARD_MODE_KEY = "tandem.keyboardMode";
// Retain the existing key for compatibility; only mobile layouts apply this preference.
export const SEND_MODE_KEY = "tandem.sendMode";

export function storedSendMode(): SendMode {
  try {
    return preferences.getItem(SEND_MODE_KEY) === "followUp" ? "followUp" : "steer";
  } catch {
    return "steer";
  }
}

export function storedKeyboardMode(): KeyboardMode {
  try {
    return preferences.getItem(KEYBOARD_MODE_KEY) === "emacs" ? "emacs" : "platform";
  } catch {
    return "platform";
  }
}

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
        {mobile && (
          <>
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
            <DropdownMenuSeparator />
          </>
        )}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
