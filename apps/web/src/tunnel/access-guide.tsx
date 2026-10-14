import type { TunnelIdentity } from "@tandem/contracts";
import { addressHostname, cloudflareLinks } from "./cloudflare.ts";
import { Copyable, FormValues, OnThatPage, OpenLink, Outcome, Warning } from "./step.tsx";

/** Cloudflare Access in front of the public hostname, so only the owner reaches Tandem. */
export function AccessGuide({ tunnel, address }: { tunnel?: TunnelIdentity; address: string }) {
  const host = addressHostname(address) ?? "tandem.example.com";
  const link = cloudflareLinks.accessApplications(tunnel);

  return (
    <div className="space-y-3">
      <Warning title="A connected tunnel is not a login">
        Anyone on the internet can reach the address until you protect it here. Complete this before adding the route so
        the address is never exposed unprotected.
      </Warning>

      <div>
        <OpenLink href={link}>Open Cloudflare Access applications</OpenLink>
      </div>

      <OnThatPage>
        <li>
          Choose <strong>Add an application</strong> (or <strong>Create new application</strong>) →{" "}
          <strong>Self-hosted</strong>.
        </li>
        <li>
          Fill in the application details:
          <div className="mt-2">
            <FormValues
              values={[
                { label: "Application name", value: "Tandem" },
                { label: "Public hostname", value: host },
                { label: "Path", value: "", empty: "Leave empty" },
              ]}
            />
          </div>
        </li>
        <li>
          Under <strong>Access policies</strong>, add a policy:
          <ul className="mt-1 list-disc pl-5 space-y-1 text-muted-foreground">
            <li>
              Action: <strong className="text-foreground">Allow</strong>
            </li>
            <li>
              Include: <strong className="text-foreground">Emails</strong> → enter your exact email address
            </li>
            <li>
              <strong className="text-destructive">Never choose Everyone or Bypass.</strong>
            </li>
          </ul>
        </li>
        <li>
          Choose your identity provider (or enable <strong>One-time PIN</strong> for email codes), then save.
        </li>
      </OnThatPage>

      <Outcome>The Access application is listed protecting {host}.</Outcome>
    </div>
  );
}

/** Proof that Access really is in front of the address, before a phone is trusted with it. */
export function AccessVerification({ address }: { address: string }) {
  const host = addressHostname(address) ?? "tandem.example.com";

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground">
        Open <Copyable value={`https://${host}`} /> in a <strong>private browser window</strong> and check:
      </p>
      <ul className="list-inside list-disc space-y-1 text-sm">
        <li>Cloudflare asks you to sign in before Tandem appears.</li>
        <li>Your email gets in.</li>
        <li>A different, unlisted email is refused.</li>
      </ul>
      <p className="text-xs text-muted-foreground">
        If Tandem appears without that login, fix the Access policy before proceeding.
      </p>
    </div>
  );
}
