import type { TunnelIdentity } from "@tandem/contracts";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Field, FieldLabel } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { AccessGuide, AccessVerification } from "./access-guide.tsx";
import { cloudflareLinks, ORIGIN_SERVICE_URL, pastedToken, validAddress } from "./cloudflare.ts";
import { FormValues, OnThatPage, OpenLink, Outcome, Step } from "./step.tsx";

export function WebsiteSetupSteps({
  connected,
  installed,
  origin,
  currentAddress,
  token,
  publishing,
  tunnel,
  routeSplit,
  stopControl,
  onOriginChange,
  onTokenChange,
  onSubmit,
}: {
  connected: boolean;
  installed: boolean;
  origin: string;
  currentAddress: string;
  token: string;
  publishing: boolean;
  tunnel?: TunnelIdentity;
  routeSplit: { subdomain: string; domain: string };
  stopControl: ReactNode;
  onOriginChange(value: string): void;
  onTokenChange(value: string): void;
  onSubmit(event: React.FormEvent): void;
}) {
  return (
    <ol aria-label="Cloudflare website setup steps" className="space-y-6">
      <Step number={1} where="Cloudflare" title="Create a tunnel" done={connected}>
        <div>
          <OpenLink href={cloudflareLinks.tunnels(tunnel)}>Open Cloudflare Tunnels</OpenLink>
        </div>
        <OnThatPage>
          <li>Sign in and select your Cloudflare account if prompted.</li>
          <li>
            Click <strong>Create a tunnel</strong>, choose connector type <strong>Cloudflared</strong>, and enter a name
            (e.g. <code>tandem-macbook</code>).
          </li>
          <li>
            Click <strong>Save tunnel</strong>.
          </li>
        </OnThatPage>
        <Outcome>
          Cloudflare displays the connector setup page showing <strong>Install and run a connector</strong>. Leave this
          tab open.
        </Outcome>
      </Step>

      <Step number={2} where="Tandem" title="Connect this machine" done={connected}>
        {connected ? (
          <div className="space-y-3">
            <p className="text-muted-foreground">
              This machine is already connected. To use a different tunnel or address, remove the current one first.
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
                  The value after --token, not the whole command. You can also paste the full cloudflared run command.
                </p>
              </Field>
              <div>
                <Button
                  type="submit"
                  disabled={!installed || !validAddress(origin) || token.trim() === "" || publishing}
                >
                  {publishing && <Spinner />}
                  {publishing ? "Publishing…" : "Publish"}
                </Button>
              </div>
            </form>
            <Outcome>This page reports “Tunnel connected”. Next, configure Access and the published route.</Outcome>
          </div>
        )}
      </Step>

      <Step number={3} where="Cloudflare" title="Protect the hostname">
        <AccessGuide tunnel={tunnel} address={origin} />
      </Step>

      <Step number={4} where="Cloudflare" title="Publish the route">
        <div className="space-y-3">
          <p className="text-muted-foreground">
            In Cloudflare, open your tunnel's route management page. If you still have the page from step 1 open, click{" "}
            <strong>Continue</strong>. Otherwise, jump directly to the tunnel:
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
            Once Access verification passes, open <strong>Devices</strong> from the Tandem sidebar on this computer,
            click <strong>Create pairing link</strong>, and open that public link on your phone within five minutes.
          </p>
          <Outcome>
            Bookmark {currentAddress} on your phone. You can now use Tandem from anywhere, including cellular data.
          </Outcome>
        </div>
      </Step>
    </ol>
  );
}
