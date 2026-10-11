import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationSummary } from "@tandem/contracts";
import {
  BikeIcon,
  ChevronRightIcon,
  FolderIcon,
  KeyRoundIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftIcon,
  SquarePenIcon,
  SunIcon,
} from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
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
    // Collapsed, the sidebar keeps a column of icons; the conversation list and the directory field hide.
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarBrand />
        <NewConversation onCreated={onSelect} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Conversations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {byDirectory(list).map(([cwd, group]) => (
                <Collapsible key={cwd} defaultOpen className="group/directory" render={<SidebarMenuItem />}>
                  <CollapsibleTrigger render={<SidebarMenuButton title={cwd} />}>
                    <FolderIcon />
                    <span className="truncate font-mono text-xs">{shortPath(cwd)}</span>
                    <ChevronRightIcon className="ml-auto transition-transform group-data-[open]/directory:rotate-90" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {group.map((summary) => (
                        <SidebarMenuSubItem key={summary.id}>
                          <SidebarMenuSubButton
                            isActive={summary.id === selected}
                            onClick={() => onSelect(summary.id)}
                            render={<button type="button" className="w-full" />}
                          >
                            <span className="truncate">{summary.title ?? "New conversation"}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Model providers" onClick={() => providers.open()}>
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

/** The name, and the button that folds the sidebar. Folded, the name's icon is what unfolds it. */
function SidebarBrand() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={collapsed ? "Expand the sidebar" : undefined}
          aria-label={collapsed ? "Expand the sidebar" : undefined}
          onClick={collapsed ? toggleSidebar : undefined}
          className="font-semibold"
        >
          <BikeIcon />
          <span>Tandem</span>
        </SidebarMenuButton>
        <SidebarMenuAction onClick={toggleSidebar} aria-label="Collapse the sidebar" title="Collapse the sidebar">
          <PanelLeftIcon />
        </SidebarMenuAction>
      </SidebarMenuItem>
    </SidebarMenu>
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
      <DropdownMenuTrigger render={<SidebarMenuButton tooltip={`Theme: ${current?.label}`} />}>
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

/**
 * Start a conversation in a directory. Collapsed, the button opens the sidebar instead, where the directory is
 * entered.
 */
function NewConversation({ onCreated }: { onCreated: (id: number) => void }) {
  const { conversations } = useConnected();
  const { state, setOpen } = useSidebar();
  const field = useRef<HTMLInputElement>(null);
  const [cwd, setCwd] = useState(() => localStorage.getItem(LAST_CWD_KEY) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const create = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (state === "collapsed") {
      setOpen(true);
      // After the sidebar has rendered expanded, where the field shows again.
      requestAnimationFrame(() => field.current?.focus());
      return;
    }
    if (cwd.trim() === "") {
      field.current?.focus();
      return;
    }
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
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton type="submit" tooltip="New conversation" disabled={creating}>
            <SquarePenIcon />
            <span>New conversation</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <Field data-invalid={error !== null} className="mt-2 gap-2 group-data-[collapsible=icon]:hidden">
        <SidebarInput
          ref={field}
          value={cwd}
          onChange={(event) => setCwd(event.target.value)}
          placeholder="/absolute/path/to/repository"
          aria-label="Directory"
          aria-invalid={error !== null}
          spellCheck={false}
          className="font-mono"
        />
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
