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
import { useState } from "react";
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
import { FieldError } from "@/components/ui/field";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
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
 * The app's navigation: conversations grouped by their directory, which stands in for workspaces until those exist.
 * A conversation's link sets the URL hash, which is how the open conversation is chosen.
 */
export function AppSidebar({ selected, onSelect }: { selected: number | null; onSelect: (id: number) => void }) {
  const { conversations } = useConnected();
  const list = useReplicatedState(conversations.state)?.conversations ?? [];
  const providers = useProvidersDialog();
  return (
    // Collapsed, the sidebar keeps a column of icons; the directory tree hides.
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarBrand />
        <NewConversation onCreated={onSelect} currentCwd={list.find((summary) => summary.id === selected)?.cwd} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Workspaces</SidebarGroupLabel>
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
                          <SidebarMenuSubButton href={`#${summary.id}`} isActive={summary.id === selected}>
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
        {/* Folded, the icon is the button that unfolds the sidebar; unfolded, the name is only a name. */}
        {collapsed ? (
          <SidebarMenuButton tooltip="Expand the sidebar" aria-label="Expand the sidebar" onClick={toggleSidebar}>
            <BikeIcon />
          </SidebarMenuButton>
        ) : (
          <div className="flex h-8 items-center gap-2 px-2 text-sm font-semibold [&>svg]:size-4">
            <BikeIcon />
            Tandem
          </div>
        )}
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
        <span>{current?.label}</span>
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

/** Start a conversation in the open conversation's directory, or else in the last one a conversation started in. */
function NewConversation({
  onCreated,
  currentCwd,
}: {
  onCreated: (id: number) => void;
  currentCwd: string | undefined;
}) {
  const { conversations } = useConnected();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const cwd = currentCwd ?? localStorage.getItem(LAST_CWD_KEY) ?? undefined;

  const create = async (): Promise<void> => {
    if (cwd === undefined) return;
    setCreating(true);
    setError(null);
    try {
      const id = await conversations.create({ cwd }, BACKGROUND_CONTEXT);
      localStorage.setItem(LAST_CWD_KEY, cwd);
      onCreated(id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setCreating(false);
    }
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip="New conversation"
          disabled={creating || cwd === undefined}
          onClick={() => void create()}
        >
          <SquarePenIcon />
          <span>New conversation</span>
        </SidebarMenuButton>
        {error !== null && <FieldError className="px-2 group-data-[collapsible=icon]:hidden">{error}</FieldError>}
      </SidebarMenuItem>
    </SidebarMenu>
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
