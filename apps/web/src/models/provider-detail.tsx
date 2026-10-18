import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AuthType } from "@tandem/contracts";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { FieldError } from "@/components/ui/field.tsx";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { LoginFlow } from "./login-flow.tsx";
import { sourceLabel } from "./provider-search.tsx";

export function ProviderDetail({ providerId, onBack }: { providerId: string; onBack: () => void }) {
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
