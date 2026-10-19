import { CopyCommand } from "./copy-command.tsx";

export function CloudflaredInstallNotice() {
  return (
    <section className="space-y-2">
      <h2 className="font-medium">Install cloudflared on the host</h2>
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
  );
}
