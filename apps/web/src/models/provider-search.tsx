import type { ProviderSummary } from "@tandem/contracts";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.tsx";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";

export function sourceLabel(provider: ProviderSummary): string {
  const configured = provider.configured;
  if (configured === undefined) return "";
  if (provider.stored) return configured.type === "oauth" ? "Signed in" : "API key";
  return configured.source ?? "Environment";
}

export function ProviderSearch({
  providers,
  onSelect,
}: {
  providers: readonly ProviderSummary[];
  onSelect(id: string): void;
}) {
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
                <ProviderListItem key={provider.id} provider={provider} onSelect={onSelect} />
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Available">
            {others.map((provider) => (
              <ProviderListItem key={provider.id} provider={provider} onSelect={onSelect} />
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </>
  );
}

function ProviderListItem({ provider, onSelect }: { provider: ProviderSummary; onSelect(id: string): void }) {
  return (
    <CommandItem value={`${provider.name} ${provider.id}`} onSelect={() => onSelect(provider.id)}>
      <span className="flex-1 truncate">{provider.name}</span>
      {provider.configured !== undefined && <Badge variant="secondary">{sourceLabel(provider)}</Badge>}
    </CommandItem>
  );
}
