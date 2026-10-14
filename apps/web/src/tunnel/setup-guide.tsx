import { type ReactNode, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyCommand } from "./copy-command.tsx";

const example = "https://tandem.example.com";

export function PublicAccessSetupGuide({ children, installed }: { children: ReactNode; installed: boolean }) {
  const [machine, setMachine] = useState("same");
  const remote = machine === "remote";
  return (
    <section className="min-w-0 space-y-5 text-sm [overflow-wrap:anywhere]" aria-label="Getting started">
      <p className="text-muted-foreground">
        Before you start: a domain managed by Cloudflare and cloudflared on the Tandem host.
      </p>
      {!installed && (
        <section className="space-y-2">
          <h3 className="font-medium">Install cloudflared on the host</h3>
          <CopyCommand command="brew install cloudflared" />
          <p className="text-xs text-muted-foreground">
            macOS command. For{" "}
            <a
              className="underline"
              href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
              target="_blank"
              rel="noreferrer"
            >
              Linux / Windows
            </a>
            , follow the installation guide. Then reopen this dialog.
          </p>
        </section>
      )}
      <Tabs defaultValue="website" className="min-w-0">
        <TabsList aria-label="Setup method">
          <TabsTrigger value="website">Cloudflare website</TabsTrigger>
          <TabsTrigger value="cli">CLI</TabsTrigger>
        </TabsList>
        <TabsContent value="website" className="min-w-0 pt-4">
          <ol className="list-inside list-decimal space-y-6 marker:font-medium">
            <Step title="Create a tunnel">
              <a
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href="https://one.dash.cloudflare.com/"
                target="_blank"
                rel="noreferrer"
              >
                Open Cloudflare dashboard ↗
              </a>
              <p className="text-muted-foreground">
                Networks → Connectors → Cloudflare Tunnels → Create a tunnel → Cloudflared.
              </p>
              <p className="text-xs text-muted-foreground">
                Some dashboards call this Networks → Tunnels. Copy only the token from the installation command; do not
                run the command.
              </p>
            </Step>
            <Step title="Route your hostname">
              <p className="text-muted-foreground">
                Add a Published application route (or Public hostname), then save:
              </p>
              <RouteValues />
              <p className="text-xs text-muted-foreground">
                Creating on another computer? Transfer only the token to the Tandem host. The origin address refers to
                that host.
              </p>
            </Step>
            <Step title="Publish from Tandem">{children}</Step>
          </ol>
        </TabsContent>
        <TabsContent value="cli" className="min-w-0 space-y-4 pt-4">
          <Tabs value={machine} onValueChange={(value) => setMachine(String(value))}>
            <TabsList variant="line" aria-label="Machine arrangement">
              <TabsTrigger value="same">Same machine</TabsTrigger>
              <TabsTrigger value="remote">Two machines</TabsTrigger>
            </TabsList>
            <TabsContent value={machine} className="min-w-0 space-y-4 pt-3">
              <p className="text-xs text-muted-foreground">
                Run in a Tandem checkout. Replace tandem.example.com with your hostname.
              </p>
              <ol className="list-inside list-decimal space-y-6 marker:font-medium">
                <Step title={remote ? "On A · Create the tunnel" : "On the host · Create the tunnel"}>
                  <CopyCommand
                    key={machine}
                    command={`bun run tunnel ${remote ? "create" : "setup"} --public-url ${example}`}
                  />
                  <p className="text-muted-foreground">Approve your domain in the browser.</p>
                  <p className="text-xs text-muted-foreground">
                    {remote
                      ? "A is your trusted computer; install cloudflared there too. Keep the account certificate on A and transfer only the printed token to B."
                      : "Use only on your private machine: this leaves account authority here. No token needs copying."}
                  </p>
                </Step>
                {remote && (
                  <Step title="In Cloudflare · Configure the route">
                    <p className="text-muted-foreground">
                      Migrate the CLI-created tunnel to remote management, then add a published application route:
                    </p>
                    <RouteValues />
                    <p className="text-xs text-muted-foreground">
                      127.0.0.1 means B, the Tandem host. DNS alone does not configure the origin.
                    </p>
                  </Step>
                )}
                {remote && (
                  <Step title="On B · Configure Tandem">
                    <CopyCommand command={`bun run tunnel configure --public-url ${example} --token-file -`} />
                    <p className="text-muted-foreground">Paste the token, press Enter, then Ctrl-D.</p>
                  </Step>
                )}
                <Step title={remote ? "On B · Start and verify" : "On the host · Start and verify"}>
                  <p className="text-muted-foreground">
                    An installed service reloads automatically. Otherwise stop foreground Tandem and start it again:
                  </p>
                  <CopyCommand command="bun run start" />
                  <p className="text-muted-foreground">Check the connection in another terminal:</p>
                  <CopyCommand command="bun run tunnel status --verify" />
                </Step>
              </ol>
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
      <div className="space-y-2 border-t pt-4 text-xs text-muted-foreground">
        <p>
          Protect the hostname with Cloudflare Access, allowing only you. Paired devices can run agents and terminals
          here. Keep the token private.
        </p>
        <p>
          <strong className="text-foreground">Pair your phone:</strong> create a link in Devices, then open its
          public-hostname URL on your phone within five minutes. Keep the host awake and running.
        </p>
      </div>
    </section>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="min-w-0">
      <h3 className="inline font-medium">{title}</h3>
      <div className="mt-2 min-w-0 space-y-2">{children}</div>
    </li>
  );
}

function RouteValues() {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 rounded-lg bg-muted p-3">
      <dt className="text-muted-foreground">Subdomain</dt>
      <dd>
        <code>tandem</code>
      </dd>
      <dt className="text-muted-foreground">Domain</dt>
      <dd>
        Select your Cloudflare domain, e.g. <code>example.com</code>
      </dd>
      <dt className="text-muted-foreground">Path</dt>
      <dd>Leave empty</dd>
      <dt className="text-muted-foreground">Service</dt>
      <dd className="font-mono">HTTP</dd>
      <dt className="text-muted-foreground">URL</dt>
      <dd className="font-mono">127.0.0.1:4820</dd>
      <dt className="text-muted-foreground">Public address</dt>
      <dd>
        <code>https://tandem.example.com</code>
        <span className="mt-1 block text-xs text-muted-foreground">
          Replace example.com with your domain. Use the resulting HTTPS address when configuring Tandem.
        </span>
      </dd>
    </dl>
  );
}
