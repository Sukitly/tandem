import { BikeIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar.tsx";

/** The name and the sidebar toggle, with directional icons matching the project panel's toggle. */
export function SidebarBrand() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {collapsed ? (
          <SidebarMenuButton aria-label="Expand the sidebar" onClick={toggleSidebar}>
            <ChevronRightIcon />
          </SidebarMenuButton>
        ) : (
          <div className="flex h-8 items-center gap-2 pl-2">
            <div className="flex flex-1 items-center gap-2 text-sm font-semibold [&>svg]:size-4">
              <BikeIcon />
              Tandem
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="Collapse the sidebar" onClick={toggleSidebar}>
              <ChevronLeftIcon />
            </Button>
          </div>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** A button to open or close the sidebar on small screens. */
export function SidebarToggle({ className }: { className?: string } = {}) {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label="Expand the sidebar"
      onClick={toggleSidebar}
    >
      <ChevronRightIcon />
    </Button>
  );
}
