import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { createAppRouter } from "./app/router.tsx";
import { SessionLayout } from "./app/session.tsx";
import { ThemeProvider, useTheme } from "./theme.tsx";

function AppToaster() {
  const { choice } = useTheme();
  return <Toaster theme={choice} closeButton />;
}

export function App({ pairCode }: { pairCode?: string } = {}) {
  const [router] = useState(() => createAppRouter({ pairCode, layout: SessionLayout }));
  return (
    <ThemeProvider>
      <TooltipProvider>
        <AppToaster />
        <RouterProvider router={router} />
      </TooltipProvider>
    </ThemeProvider>
  );
}
