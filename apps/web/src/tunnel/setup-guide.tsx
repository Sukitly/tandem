import type { TunnelIdentity } from "@tandem/contracts";
import { type ReactNode, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { CliSetupSteps } from "./cli-setup-steps.tsx";
import { addressHostname, EXAMPLE_ADDRESS, splitHostname, validAddress } from "./cloudflare.ts";
import { CloudflaredInstallNotice } from "./cloudflared-install.tsx";
import { WebsiteSetupSteps } from "./website-setup-steps.tsx";

export interface PublicAccessFlowProps {
  installed: boolean;
  connected: boolean;
  origin: string;
  token: string;
  onOriginChange(value: string): void;
  onTokenChange(value: string): void;
  onSubmit(event: React.FormEvent): void;
  publishing?: boolean;
  tunnel?: TunnelIdentity;
  stopControl: ReactNode;
}

/**
 * Step-by-step guidelines for setting up public access.
 * Every step clearly shows where the action happens (Cloudflare, Tandem, Phone),
 * provides direct links to the exact dashboard pages, and shows expected outcomes.
 */
export function PublicAccessFlow({
  installed,
  connected,
  origin,
  token,
  onOriginChange,
  onTokenChange,
  onSubmit,
  publishing = false,
  tunnel,
  stopControl,
}: PublicAccessFlowProps) {
  const host = addressHostname(origin) ?? "tandem.example.com";
  const currentAddress = validAddress(origin) ? origin.trim() : EXAMPLE_ADDRESS;
  const routeSplit = useMemo(() => splitHostname(host), [host]);

  return (
    <section className="min-w-0 space-y-6 text-sm [overflow-wrap:anywhere]" aria-label="Setup steps">
      {!installed && <CloudflaredInstallNotice />}

      <Tabs defaultValue="website" className="min-w-0">
        <TabsList aria-label="Setup method">
          <TabsTrigger value="website">Cloudflare website</TabsTrigger>
          <TabsTrigger value="cli">CLI</TabsTrigger>
        </TabsList>

        <TabsContent value="website" className="min-w-0 pt-4">
          <WebsiteSetupSteps
            connected={connected}
            installed={installed}
            origin={origin}
            currentAddress={currentAddress}
            token={token}
            publishing={publishing}
            tunnel={tunnel}
            routeSplit={routeSplit}
            stopControl={stopControl}
            onOriginChange={onOriginChange}
            onTokenChange={onTokenChange}
            onSubmit={onSubmit}
          />
        </TabsContent>

        <TabsContent value="cli" className="min-w-0 space-y-4 pt-4">
          <CliSetupSteps currentAddress={currentAddress} origin={origin} tunnel={tunnel} routeSplit={routeSplit} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
