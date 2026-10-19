import type { TunnelIdentity } from "@tandem/contracts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { AccessGuide, AccessVerification } from "./access-guide.tsx";
import { cloudflareLinks, ORIGIN_SERVICE_URL } from "./cloudflare.ts";
import { CopyCommand } from "./copy-command.tsx";
import { FormValues, OpenLink, Outcome, Step } from "./step.tsx";

export function CliSetupSteps({
  currentAddress,
  origin,
  tunnel,
  routeSplit,
}: {
  currentAddress: string;
  origin: string;
  tunnel?: TunnelIdentity;
  routeSplit: { subdomain: string; domain: string };
}) {
  return (
    <Tabs defaultValue="same" className="min-w-0">
      <TabsList aria-label="Where the tunnel is created">
        <TabsTrigger value="same">This machine</TabsTrigger>
        <TabsTrigger value="remote">Another computer</TabsTrigger>
      </TabsList>

      <TabsContent value="same" className="min-w-0 pt-4">
        <ol aria-label="Same machine CLI setup steps" className="space-y-6">
          <Step number={1} where="Terminal" title="Create the tunnel and the route">
            <div className="space-y-2">
              <p className="text-muted-foreground">Run on the Tandem host in your terminal:</p>
              <CopyCommand command={`bun run tunnel setup --public-url ${currentAddress}`} />
            </div>
            <Outcome>A browser opens to approve your domain, and the command reports “Tunnel … is ready.”</Outcome>
          </Step>

          <Step number={2} where="Terminal" title="Start Tandem with the tunnel">
            <div className="space-y-2">
              <p className="text-muted-foreground">
                An installed service reloads automatically. Otherwise restart Tandem and check status:
              </p>
              <CopyCommand command="bun run start" />
              <CopyCommand command="bun run tunnel status --verify" />
            </div>
            <Outcome>The tunnel connects, and the hostname already points to this machine.</Outcome>
          </Step>

          <Step number={3} where="Cloudflare" title="Protect the hostname">
            <AccessGuide tunnel={tunnel} address={origin} />
          </Step>

          <Step number={4} where="Phone" title="Verify, then pair your phone" last>
            <div className="space-y-3">
              <AccessVerification address={origin} />
              <p className="text-muted-foreground">
                Open <strong>Devices</strong> in this paired browser, create a pairing link, and open it on your phone
                within five minutes.
              </p>
              <Outcome>Bookmark {currentAddress}. Keep the Tandem host awake.</Outcome>
            </div>
          </Step>
        </ol>
      </TabsContent>

      <TabsContent value="remote" className="min-w-0 pt-4">
        <p className="text-xs text-muted-foreground mb-4">
          A is your trusted computer; B runs Tandem. Only a token travels between them.
        </p>
        <ol aria-label="Two machine CLI setup steps" className="space-y-6">
          <Step number={1} where="Terminal" title="Create the tunnel">
            <div className="space-y-2">
              <p className="text-muted-foreground">On computer A (with Cloudflare account authority):</p>
              <CopyCommand command={`bun run tunnel create --public-url ${currentAddress}`} />
            </div>
            <Outcome>Approving the domain prints a connector token. A keeps Cloudflare account authority.</Outcome>
          </Step>

          <Step number={2} where="Cloudflare" title="Publish the route">
            <div className="space-y-3">
              <p className="text-muted-foreground">
                In Cloudflare, migrate this tunnel to remote management if needed, then add the route:
              </p>
              <div>
                <OpenLink href={cloudflareLinks.tunnelRoutes(tunnel)}>
                  {tunnel !== undefined ? "Open Tunnel in Cloudflare" : "Open Cloudflare Tunnels"}
                </OpenLink>
              </div>
              <FormValues
                values={[
                  { label: "Subdomain", value: routeSplit.subdomain, empty: "(empty for apex)" },
                  { label: "Domain", value: routeSplit.domain },
                  { label: "Path", value: "", empty: "Leave empty" },
                  { label: "Service type", value: "HTTP" },
                  { label: "URL", value: ORIGIN_SERVICE_URL.replace(/^https?:\/\//, "") },
                ]}
              />
            </div>
            <Outcome>The route is registered in Cloudflare.</Outcome>
          </Step>

          <Step number={3} where="Terminal" title="Configure Tandem with the token">
            <div className="space-y-2">
              <p className="text-muted-foreground">On computer B (the Tandem host):</p>
              <CopyCommand command={`bun run tunnel configure --public-url ${currentAddress} --token-file -`} />
              <p className="text-xs text-muted-foreground">Paste the token, press Enter, then Ctrl-D.</p>
            </div>
            <Outcome>B saves the configuration at mode 0600. It never gets Cloudflare account keys.</Outcome>
          </Step>

          <Step number={4} where="Terminal" title="Start Tandem with the tunnel">
            <div className="space-y-2">
              <p className="text-muted-foreground">
                An installed service reloads automatically. Otherwise restart Tandem and check:
              </p>
              <CopyCommand command="bun run start" />
              <CopyCommand command="bun run tunnel status --verify" />
            </div>
            <Outcome>The tunnel connects, and {currentAddress} reaches Tandem.</Outcome>
          </Step>

          <Step number={5} where="Cloudflare" title="Protect the hostname">
            <AccessGuide tunnel={tunnel} address={origin} />
          </Step>

          <Step number={6} where="Phone" title="Verify, then pair your phone" last>
            <div className="space-y-3">
              <AccessVerification address={origin} />
              <p className="text-muted-foreground">
                Open <strong>Devices</strong> in this paired browser, create a pairing link, and open it on your phone
                within five minutes.
              </p>
              <Outcome>Bookmark {currentAddress}. Keep the host awake.</Outcome>
            </div>
          </Step>
        </ol>
      </TabsContent>
    </Tabs>
  );
}
