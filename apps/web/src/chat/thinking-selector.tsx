import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";

export function ThinkingSelector({
  level,
  levels,
  disabled,
  onSelect,
}: {
  level: string;
  levels: readonly string[];
  disabled?: boolean;
  onSelect(level: string): void;
}) {
  if (levels.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="shrink-0" disabled={disabled} />}>
        <span className="hidden sm:inline">{thinkingLabel(level)}</span>
        <span className="sm:hidden">{shortThinkingLabel(level)}</span>
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Thinking</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={level} onValueChange={onSelect}>
            {levels.map((option) => (
              <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                {option === "off" ? "Off" : option[0]?.toUpperCase() + option.slice(1)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function thinkingLabel(level: string): string {
  return level === "off" ? "No thinking" : `Thinking: ${level}`;
}

function shortThinkingLabel(level: string): string {
  return level === "off" ? "Off" : (level[0]?.toUpperCase() ?? "") + level.slice(1);
}
