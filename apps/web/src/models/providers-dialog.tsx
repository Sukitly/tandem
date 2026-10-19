import { createContext, type ReactNode, useContext, useState } from "react";
import { ResponsiveDialogContent as DialogContent } from "@/components/responsive-dialog.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ProviderDetail } from "./provider-detail.tsx";
import { ProviderSearch } from "./provider-search.tsx";

interface ProvidersDialogControl {
  /** Open the dialog, optionally on one provider. */
  open(providerId?: string): void;
}

const ProvidersDialogContext = createContext<ProvidersDialogControl>({ open: () => {} });

export function useProvidersDialog(): ProvidersDialogControl {
  return useContext(ProvidersDialogContext);
}

/** Provides the model providers dialog to everything inside. */
export function ProvidersDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState<string | null>(null);
  const { models } = useConnected();
  const providers = useReplicatedState(models.state)?.providers ?? [];

  return (
    <ProvidersDialogContext.Provider
      value={{
        open: (id) => {
          setProviderId(id ?? null);
          setOpen(true);
        },
      }}
    >
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          {providerId === null ? (
            <ProviderSearch providers={providers} onSelect={setProviderId} />
          ) : (
            <ProviderDetail key={providerId} providerId={providerId} onBack={() => setProviderId(null)} />
          )}
        </DialogContent>
      </Dialog>
    </ProvidersDialogContext.Provider>
  );
}
