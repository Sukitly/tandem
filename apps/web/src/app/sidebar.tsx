import type { ConversationSummary, WorkspaceSummary } from "@tandem/contracts";
import {
  BikeIcon,
  EllipsisIcon,
  FolderIcon,
  FolderMinusIcon,
  FolderOpenIcon,
  KeyRoundIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftIcon,
  PlusIcon,
  SquarePenIcon,
  SunIcon,
} from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
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
import { Spinner } from "@/components/ui/spinner";
import { useProvidersDialog } from "@/models/providers-dialog.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { type ThemeChoice, useTheme } from "@/theme.tsx";
import { useWorkbench } from "./workbench.tsx";

/**
 * The app's navigation, after the Codex app: projects with their conversations, then every conversation by recent
 * activity. A conversation's link sets the URL hash, which is how the open conversation is chosen.
 */
export function AppSidebar() {
  const { workspaces, conversations } = useConnected();
  const projects = useReplicatedState(workspaces.state)?.workspaces ?? [];
  const list = useReplicatedState(conversations.state)?.conversations ?? [];
  const { selected, addProject } = useWorkbench();
  const providers = useProvidersDialog();
  const names = new Map(projects.map((project) => [project.id, project.name]));
  return (
    // Collapsed, the sidebar keeps a column of icons; the lists hide.
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarBrand />
        <NewConversation projects={projects} current={list.find((summary) => summary.id === selected)?.workspaceId} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupAction title="Add project" aria-label="Add project" onClick={addProject}>
            <PlusIcon />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.map((project) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  conversations={list.filter((summary) => summary.workspaceId === project.id)}
                  selected={selected}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {list.length > 0 && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Recents</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {list.map((summary) => (
                  <SidebarMenuItem key={summary.id}>
                    <SidebarMenuButton
                      render={<a href={`#${summary.id}`} />}
                      isActive={summary.id === selected}
                      title={summary.cwd}
                    >
                      <span className="truncate">{titleOf(summary)}</span>
                      {summary.running ? (
                        <Spinner aria-label="Running" className="ml-auto" />
                      ) : (
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {names.get(summary.workspaceId)}
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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

/** A project that opens to show its conversations. On hover: start a conversation in it, or remove it. */
function ProjectItem({
  project,
  conversations,
  selected,
}: {
  project: WorkspaceSummary;
  conversations: ConversationSummary[];
  selected: number | null;
}) {
  const { startConversation, removeProject, starting } = useWorkbench();
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen} render={<SidebarMenuItem />}>
      {/* Room for both actions, which sit side by side at the row's end. */}
      <CollapsibleTrigger
        render={
          <SidebarMenuButton title={project.path} className="group-has-data-[sidebar=menu-action]/menu-item:pr-14" />
        }
      >
        {open ? <FolderOpenIcon /> : <FolderIcon />}
        <span>{project.name}</span>
      </CollapsibleTrigger>
      <SidebarMenuAction
        showOnHover
        className="right-7"
        title={`New conversation in ${project.name}`}
        aria-label={`New conversation in ${project.name}`}
        disabled={starting}
        onClick={() => startConversation(project.id)}
      >
        <PlusIcon />
      </SidebarMenuAction>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<SidebarMenuAction showOnHover title="More" aria-label={`More for ${project.name}`} />}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onClick={() => removeProject(project.id)}>
            <FolderMinusIcon />
            Remove project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CollapsibleContent>
        <SidebarMenuSub>
          {conversations.map((summary) => (
            <SidebarMenuSubItem key={summary.id}>
              <SidebarMenuSubButton href={`#${summary.id}`} isActive={summary.id === selected}>
                <span className="truncate">{titleOf(summary)}</span>
                {summary.running && <Spinner aria-label="Running" className="ml-auto" />}
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
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

/**
 * Start a conversation in the open conversation's project, else in the project a conversation was last started in,
 * else in the first project.
 */
function NewConversation({ projects, current }: { projects: WorkspaceSummary[]; current: number | undefined }) {
  const { startConversation, starting, lastWorkspaceId } = useWorkbench();
  const listed = (id: number | undefined) => projects.find((project) => project.id === id)?.id;
  const target = listed(current) ?? listed(lastWorkspaceId) ?? projects[0]?.id;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip="New conversation"
          disabled={starting || target === undefined}
          onClick={() => target !== undefined && startConversation(target)}
        >
          <SquarePenIcon />
          <span>New conversation</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function titleOf(summary: ConversationSummary): string {
  return summary.title ?? "New conversation";
}
