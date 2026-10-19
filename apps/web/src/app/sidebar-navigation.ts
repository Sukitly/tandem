import type { MouseEvent } from "react";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { isPlainClick } from "@/lib/click.ts";

/** Native links still own navigation, including modified clicks that open another tab. */
export function useCloseSidebarOnNavigate() {
  const { isMobile, setOpenMobile } = useSidebar();
  return (event?: MouseEvent): void => {
    if (event && !isPlainClick(event)) return;
    if (isMobile) setOpenMobile(false);
  };
}
