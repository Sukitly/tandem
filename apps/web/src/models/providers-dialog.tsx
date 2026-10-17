import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AuthType, ProviderSummary } from "@tandem/contracts";
import { ArrowLeftIcon } from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import { ResponsiveDialogContent as DialogContent } from "@/components/responsive-dialog.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { LoginFlow } from "./login-flow.tsx";

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
            <ProviderList onSelect={setProviderId} />
          ) : (
            <ProviderDetail key={providerId} providerId={providerId} onBack={() => setProviderId(null)} />
          )}
        </DialogContent>
      </Dialog>
    </ProvidersDialogContext.Provider>
  );
}

function ProviderList({ onSelect }: { onSelect: (id: string) => void }) {
  const { models } = useConnected();
  const providers = useReplicatedState(models.state)?.providers ?? [];
  const configured = providers.filter((provider) => provider.configured !== undefined);
  const others = providers.filter((provider) => provider.configured === undefined);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Model providers</DialogTitle>
        <DialogDescription>
          Sign in or add an API key. Credentials stay on this machine, in the server's state directory.
        </DialogDescription>
      </DialogHeader>
      <Command>
        <CommandInput placeholder="Search providers" />
        <CommandList>
          <CommandEmpty>No provider found.</CommandEmpty>
          {configured.length > 0 && (
            <CommandGroup heading="Ready">
              {configured.map((provider) => (
                <ProviderItem key={provider.id} provider={provider} onSelect={onSelect} />
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Available">
            {others.map((provider) => (
              <ProviderItem key={provider.id} provider={provider} onSelect={onSelect} />
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </>
  );
}

function ProviderItem({ provider, onSelect }: { provider: ProviderSummary; onSelect: (id: string) => void }) {
  return (
    <CommandItem value={`${provider.name} ${provider.id}`} onSelect={() => onSelect(provider.id)}>
      <span className="flex-1 truncate">{provider.name}</span>
      {provider.configured !== undefined && <Badge variant="secondary">{sourceLabel(provider)}</Badge>}
    </CommandItem>
  );
}

function ProviderDetail({ providerId, onBack }: { providerId: string; onBack: () => void }) {
  const { models } = useConnected();
  const state = useReplicatedState(models.state);
  const provider = state?.providers.find((candidate) => candidate.id === providerId);
  const login = state?.login?.providerId === providerId ? state.login : undefined;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const run = (operation: () => Promise<unknown>): void => {
    if (pending) return;
    setError(null);
    setPending(true);
    Promise.resolve()
      .then(operation)
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
      .finally(() => setPending(false));
  };
  const start = (type: AuthType): void => run(() => models.login({ providerId, type }, BACKGROUND_CONTEXT));

  if (provider === undefined) return null;
  const running = login?.status === "running";
  return (
    <>
      <DialogHeader>
        <DialogTitle>{provider.name}</DialogTitle>
        <DialogDescription>
          {provider.configured === undefined ? "Not signed in." : `Ready: ${sourceLabel(provider)}.`}
        </DialogDescription>
      </DialogHeader>
      {login !== undefined && login.status !== "cancelled" && <LoginFlow login={login} />}
      {!running && (
        <ItemGroup>
          {provider.login.map((option) => (
            <Item key={option.type} variant="outline">
              <ItemContent>
                <ItemTitle>{option.label}</ItemTitle>
                <ItemDescription>
                  {option.type === "oauth" ? "Sign in with your account" : "Enter an API key"}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button size="sm" disabled={pending} onClick={() => start(option.type)}>
                  {login?.status === "failed"
                    ? option.type === "oauth"
                      ? "Retry sign-in"
                      : "Retry adding key"
                    : option.type === "oauth"
                      ? "Sign in"
                      : "Add key"}
                </Button>
              </ItemActions>
            </Item>
          ))}
          {provider.login.length === 0 && (
            <Item variant="muted">
              <ItemContent>
                <ItemDescription>
                  This provider is configured through environment variables on the server's machine.
                </ItemDescription>
              </ItemContent>
            </Item>
          )}
        </ItemGroup>
      )}
      {error !== null && <FieldError>{error}</FieldError>}
      <DialogFooter>
        <Button variant="ghost" onClick={onBack} className="mr-auto">
          <ArrowLeftIcon />
          All providers
        </Button>
        {running && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => run(() => models.cancelLogin(BACKGROUND_CONTEXT))}
          >
            Cancel sign-in
          </Button>
        )}
        {provider.stored && !running && (
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => run(() => models.logout(providerId, BACKGROUND_CONTEXT))}
          >
            Sign out
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function sourceLabel(provider: ProviderSummary): string {
  const configured = provider.configured;
  if (configured === undefined) return "";
  if (provider.stored) return configured.type === "oauth" ? "Signed in" : "API key";
  return configured.source ?? "Environment";
}
