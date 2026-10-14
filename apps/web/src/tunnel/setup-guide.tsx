import type { TunnelIdentity } from "@tandem/contracts";
import { type ReactNode, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccessGuide, AccessVerification } from "./access-guide.tsx";
import {
  addressHostname,
  cloudflareLinks,
  EXAMPLE_ADDRESS,
  ORIGIN_SERVICE_URL,
  pastedToken,
  splitHostname,
  validAddress,
} from "./cloudflare.ts";
import { CopyCommand } from "./copy-command.tsx";
import { FormValues, OnThatPage, OpenLink, Outcome, Step } from "./step.tsx";

export interface PublicAccessFlowProps {
  installed: boolean;
  connected: boolean;
  origin: string;
  token: string;
  onOriginChange(value: string): void;
  onTokenChange(value: string): void;
  onSubmit(event: React.FormEvent): void;
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
  tunnel,
  stopControl,
}: PublicAccessFlowProps) {
  const host = addressHostname(origin) ?? "tandem.example.com";
  const currentAddress = validAddress(origin) ? origin.trim() : EXAMPLE_ADDRESS;
  const routeSplit = useMemo(() => splitHostname(host), [host]);

  return (
    <section className="min-w-0 space-y-6 text-sm [overflow-wrap:anywhere]" aria-label="Setup steps">
      {!installed && (
        <section className="space-y-2">
          <h3 className="font-medium">Install cloudflared on the host</h3>
          <p className="text-muted-foreground">Tandem cannot publish anything without it. On macOS:</p>
          <CopyCommand command="brew install cloudflared" />
          <p className="text-xs text-muted-foreground">
            For{" "}
            <a
              className="underline"
              href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
              target="_blank"
              rel="noreferrer"
            >
              Linux and Windows
            </a>
            , follow that guide. Then reopen this page.
          </p>
        </section>
      )}

      <Tabs defaultValue="website" className="min-w-0">
        <TabsList aria-label="Setup method">
          <TabsTrigger value="website">Cloudflare website</TabsTrigger>
          <TabsTrigger value="cli">CLI</TabsTrigger>
        </TabsList>

        <TabsContent value="website" className="min-w-0 pt-4">
          <ol aria-label="Cloudflare website setup steps" className="space-y-6">
            <Step number={1} where="Cloudflare" title="Create a tunnel" done={connected}>
              <div>
                <OpenLink href={cloudflareLinks.tunnels(tunnel)}>Open Cloudflare Tunnels</OpenLink>
              </div>
              <OnThatPage>
                <li>Sign in and select your Cloudflare account if prompted.</li>
                <li>
                  Click <strong>Create a tunnel</strong>, choose connector type <strong>Cloudflared</strong>, and enter
                  a name (e.g. <code>tandem-macbook</code>).
                </li>
                <li>
                  Click <strong>Save tunnel</strong>.
                </li>
              </OnThatPage>
              <Outcome>
                Cloudflare displays the connector setup page showing <strong>Install and run a connector</strong>. Leave
                this tab open.
              </Outcome>
            </Step>

            <Step number={2} where="Tandem" title="Connect this machine" done={connected}>
              {connected ? (
                <div className="space-y-3">
                  <p className="text-muted-foreground">
                    This machine is already connected. To use a different tunnel or address, remove the current one
                    first.
                  </p>
                  <div>{stopControl}</div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-muted-foreground">
                    In Cloudflare, locate <strong>Or, run tunnel (manual)</strong> and copy the token string after{" "}
                    <code>--token</code> (or copy the entire command — Tandem will extract the token for you).
                  </p>
                  <form className="flex min-w-0 flex-col gap-3 rounded-lg border p-4 bg-card" onSubmit={onSubmit}>
                    <Field>
                      <FieldLabel htmlFor="public-access-origin">The address it will answer at</FieldLabel>
                      <Input
                        id="public-access-origin"
                        value={origin}
                        onChange={(event) => onOriginChange(event.target.value)}
                        placeholder="https://tandem.example.com"
                        autoComplete="off"
                      />
                      <p className="text-xs text-muted-foreground">
                        Your chosen HTTPS address with a domain you manage in Cloudflare.
                      </p>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="public-access-token">Tunnel token</FieldLabel>
                      <Input
                        id="public-access-token"
                        value={token}
                        onChange={(event) => {
                          const parsed = pastedToken(event.target.value);
                          onTokenChange(parsed ?? event.target.value);
                        }}
                        placeholder="eyJhIjoi…"
                        autoComplete="off"
                      />
                      <p className="text-xs text-muted-foreground">
                        The value after --token, not the whole command. You can also paste the full cloudflared run
                        command.
                      </p>
                    </Field>
                    <div>
                      <Button type="submit" disabled={!installed || !validAddress(origin) || token.trim() === ""}>
                        Publish
                      </Button>
                    </div>
                  </form>
                  <Outcome>
                    This page reports “Tunnel connected”. Next, configure Access and the published route.
                  </Outcome>
                </div>
              )}
            </Step>

            <Step number={3} where="Cloudflare" title="Protect the hostname">
              <AccessGuide tunnel={tunnel} address={origin} />
            </Step>

            <Step number={4} where="Cloudflare" title="Publish the route">
              <div className="space-y-3">
                <p className="text-muted-foreground">
                  In Cloudflare, open your tunnel's route management page. If you still have the page from step 1 open,
                  click <strong>Continue</strong>. Otherwise, jump directly to the tunnel:
                </p>
                <div>
                  <OpenLink href={cloudflareLinks.tunnelRoutes(tunnel)}>
                    {tunnel !== undefined ? "Open Tunnel in Cloudflare" : "Open Cloudflare Tunnels"}
                  </OpenLink>
                </div>
                <OnThatPage>
                  <li>
                    Go to <strong>Routes</strong> (or <strong>Public Hostname</strong>) → <strong>Add route</strong> →{" "}
                    <strong>Published application</strong>.
                  </li>
                  <li>
                    Fill in the values:
                    <div className="mt-2">
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
                  </li>
                  <li>
                    Click <strong>Save route</strong>.
                  </li>
                </OnThatPage>
                <Outcome>
                  Cloudflare creates the DNS record and routes incoming HTTPS requests to your local Tandem server.
                </Outcome>
              </div>
            </Step>

            <Step number={5} where="Phone" title="Verify, then pair your phone" last>
              <div className="space-y-3">
                <AccessVerification address={origin} />
                <p className="text-muted-foreground">
                  Once Access verification passes, open <strong>Devices</strong> from the Tandem sidebar on this
                  computer, click <strong>Create pairing link</strong>, and open that public link on your phone within
                  five minutes.
                </p>
                <Outcome>
                  Bookmark {currentAddress} on your phone. You can now use Tandem from anywhere, including cellular
                  data.
                </Outcome>
              </div>
            </Step>
          </ol>
        </TabsContent>

        <TabsContent value="cli" className="min-w-0 space-y-4 pt-4">
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
                  <Outcome>
                    A browser opens to approve your domain, and the command reports “Tunnel … is ready.”
                  </Outcome>
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
                      Open <strong>Devices</strong> in this paired browser, create a pairing link, and open it on your
                      phone within five minutes.
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
                  <Outcome>
                    Approving the domain prints a connector token. A keeps Cloudflare account authority.
                  </Outcome>
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
                      Open <strong>Devices</strong> in this paired browser, create a pairing link, and open it on your
                      phone within five minutes.
                    </p>
                    <Outcome>Bookmark {currentAddress}. Keep the host awake.</Outcome>
                  </div>
                </Step>
              </ol>
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </section>
  );
}
