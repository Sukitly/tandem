import { Link } from "@tanstack/react-router";
import { GlobeIcon, KeyRoundIcon, PlusIcon } from "lucide-react";
import { useDevicesDialog } from "@/auth/devices-dialog.tsx";
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
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar.tsx";
import { useProvidersDialog } from "@/models/providers-dialog.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { useConversationId } from "./current-route.ts";
import { SidebarBrand } from "./sidebar-brand.tsx";
import { RecentConversationItem } from "./sidebar-conversation-row.tsx";
import { ProjectItem } from "./sidebar-project-item.tsx";
import { SidebarThemeMenu } from "./sidebar-theme-menu.tsx";
import { useWorkbench } from "./workbench.tsx";

export { SidebarBrand, SidebarToggle } from "./sidebar-brand.tsx";

/**
 * The app's navigation: projects with their conversations, then every conversation by recent
 * activity. A conversation's link is its page, and the open page's address is what marks it selected.
 */
export function AppSidebar() {
  const { workspaces, conversations } = useConnected();
  const projects = useReplicatedState(workspaces.state)?.workspaces ?? [];
  const list = useReplicatedState(conversations.state)?.conversations ?? [];
  const selected = useConversationId();
  const { addProject } = useWorkbench((state) => ({ addProject: state.addProject }));
  const providers = useProvidersDialog();
  const devices = useDevicesDialog();
  const names = new Map(projects.map((project) => [project.id, project.name]));

  return (
    <Sidebar collapsible="icon" variant="inset" role="navigation" aria-label="Projects and conversations">
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
                  <RecentConversationItem
                    key={summary.id}
                    summary={summary}
                    selected={selected}
                    projectName={names.get(summary.workspaceId)}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Devices" onClick={() => devices.open()}>
              <KeyRoundIcon />
              <span>Devices</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Model providers" onClick={() => providers.open()}>
              <KeyRoundIcon />
              <span>Model providers</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Public access" render={<Link to="/public-access" />}>
              <GlobeIcon />
              <span>Public access</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarThemeMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
