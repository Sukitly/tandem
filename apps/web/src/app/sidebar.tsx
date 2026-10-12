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
  SunIcon,
} from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
                      render={<a href={`#${summary.id}`} aria-current={summary.id === selected ? "page" : undefined} />}
                      isActive={summary.id === selected}
                      className={summary.id === selected ? "bg-sidebar-accent" : undefined}
                      title={summary.cwd}
                    >
                      <span className="truncate">{summary.title}</span>
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

// Scope hover and keyboard focus to the project row, not its conversation list. Touch devices keep actions visible.
const PROJECT_ACTION_CLASS =
  "opacity-0 group-hover/project-row:opacity-100 group-focus-within/project-row:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100";

/** A project that opens to show its conversations. Its row reveals actions on hover or keyboard focus. */
function ProjectItem({
  project,
  conversations,
  selected,
}: {
  project: WorkspaceSummary;
  conversations: ConversationSummary[];
  selected: number | null;
}) {
  const { newConversation, removeProject } = useWorkbench();
  const { terminals } = useConnected();
  // The project's terminals whose shell still runs: removing the project ends them, and adding it again does not bring
  // them back.
  const running = (useReplicatedState(terminals.state)?.terminals ?? []).filter(
    (summary) => summary.workspaceId === project.id && summary.exit === undefined,
  );
  const [open, setOpen] = useState(true);
  const [confirming, setConfirming] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} render={<SidebarMenuItem />}>
      <div className="group/project-row relative">
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
          className={`${PROJECT_ACTION_CLASS} right-7`}
          title={`New conversation in ${project.name}`}
          aria-label={`New conversation in ${project.name}`}
          onClick={() => newConversation(project.id)}
        >
          <PlusIcon />
        </SidebarMenuAction>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuAction
                className={PROJECT_ACTION_CLASS}
                title="More"
                aria-label={`More for ${project.name}`}
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          {/* The content takes the trigger's width by default; the trigger is an icon, as in shadcn's sidebar blocks. */}
          <DropdownMenuContent side="right" align="start" className="w-48">
            <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
              <FolderMinusIcon />
              Remove project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The project and its conversations leave the sidebar. No file or conversation is deleted: add the same
              directory again to bring them back.
            </AlertDialogDescription>
            {running.length > 0 && (
              <AlertDialogDescription>
                {running.length === 1 ? "A terminal is" : `${running.length} terminals are`} still running and will be
                ended, with what runs in {running.length === 1 ? "it" : "them"}:{" "}
                {running.map((summary) => summary.title).join(", ")}.
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                removeProject(project.id);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {conversations.length > 0 && (
        <CollapsibleContent>
          <SidebarMenuSub className="mr-0 pr-0">
            {conversations.map((summary) => (
              <SidebarMenuSubItem key={summary.id}>
                <SidebarMenuSubButton
                  href={`#${summary.id}`}
                  isActive={summary.id === selected}
                  aria-current={summary.id === selected ? "page" : undefined}
                  className={summary.id === selected ? "bg-sidebar-accent" : undefined}
                >
                  <span className="truncate">{summary.title}</span>
                  {summary.running && <Spinner aria-label="Running" className="ml-auto" />}
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      )}
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
