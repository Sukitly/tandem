import type { MouseEvent } from "react";
import { useSidebar } from "@/components/ui/sidebar.tsx";

/** Native links still own navigation, including modified clicks that open another tab. */
export function useCloseSidebarOnNavigate() {
  const { isMobile, setOpenMobile } = useSidebar();
  return (event?: MouseEvent): void => {
    if (
      event &&
      (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
    )
      return;
    if (isMobile) setOpenMobile(false);
  };
}
