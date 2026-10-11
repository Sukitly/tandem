import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationSummary } from "@tandem/contracts";
import { FolderIcon, KeyRoundIcon, MonitorIcon, MoonIcon, PlusIcon, SunIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError } from "@/components/ui/field";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useProvidersDialog } from "@/models/providers-dialog.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { type ThemeChoice, useTheme } from "@/theme.tsx";

const LAST_CWD_KEY = "tandem.lastCwd";

/**
 * Conversations grouped by directory, and a form to start one in a directory. Projects replace the directory field
 * later.
 */
export function AppSidebar({ selected, onSelect }: { selected: number | null; onSelect: (id: number) => void }) {
  const { conversations } = useConnected();
  const list = useReplicatedState(conversations.state)?.conversations ?? [];
  const providers = useProvidersDialog();
  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="font-semibold">
              Tandem
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NewConversation onCreated={onSelect} />
      </SidebarHeader>
      <SidebarContent>
        {byDirectory(list).map(([cwd, group]) => (
          <SidebarGroup key={cwd}>
            <SidebarGroupLabel title={cwd} className="font-mono">
              <FolderIcon />
              <span className="truncate">{shortPath(cwd)}</span>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.map((summary) => (
                  <SidebarMenuItem key={summary.id}>
                    <SidebarMenuButton isActive={summary.id === selected} onClick={() => onSelect(summary.id)}>
                      <span className="truncate">{summary.title ?? "New conversation"}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => providers.open()}>
              <KeyRoundIcon />
              <span>Model providers</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <ThemeMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

const THEMES: { value: ThemeChoice; label: string; icon: typeof SunIcon }[] = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

function ThemeMenu() {
  const { choice, setChoice } = useTheme();
  const current = THEMES.find((theme) => theme.value === choice) ?? THEMES[0];
  const Icon = current?.icon ?? MonitorIcon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuButton />}>
        <Icon />
        <span>Theme: {current?.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={choice} onValueChange={(value: ThemeChoice) => setChoice(value)}>
            {THEMES.map((theme) => (
              <DropdownMenuRadioItem key={theme.value} value={theme.value} closeOnClick>
                <theme.icon />
                {theme.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NewConversation({ onCreated }: { onCreated: (id: number) => void }) {
  const { conversations } = useConnected();
  const [cwd, setCwd] = useState(() => localStorage.getItem(LAST_CWD_KEY) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const create = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const id = await conversations.create({ cwd: cwd.trim() }, BACKGROUND_CONTEXT);
      localStorage.setItem(LAST_CWD_KEY, cwd.trim());
      onCreated(id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={create}>
      <Field data-invalid={error !== null} className="gap-2">
        <SidebarInput
          value={cwd}
          onChange={(event) => setCwd(event.target.value)}
          placeholder="/absolute/path/to/repository"
          aria-label="Directory"
          aria-invalid={error !== null}
          spellCheck={false}
          className="font-mono"
        />
        <Button type="submit" size="sm" disabled={creating || cwd.trim() === ""}>
          <PlusIcon />
          New conversation
        </Button>
        {error !== null && <FieldError>{error}</FieldError>}
      </Field>
    </form>
  );
}

/** Conversations by directory, directories in the order of their newest conversation. */
function byDirectory(list: readonly ConversationSummary[]): [string, ConversationSummary[]][] {
  const groups = new Map<string, ConversationSummary[]>();
  for (const summary of [...list].sort((a, b) => b.createdAt - a.createdAt)) {
    groups.set(summary.cwd, [...(groups.get(summary.cwd) ?? []), summary]);
  }
  return [...groups];
}

/** The last two segments of a path: enough to tell repositories apart in a narrow sidebar. */
function shortPath(path: string): string {
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments.length <= 2 ? path : `…/${segments.slice(-2).join("/")}`;
}
