import { DEFAULT_HOST, DEFAULT_PORT, type TunnelIdentity } from "@tandem/contracts";

/** What a published application route sends traffic to: this server, on the loopback interface, over plain HTTP. */
export const ORIGIN_SERVICE_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

/** Stands in for the person's own address until they enter one. */
export const EXAMPLE_ADDRESS = "https://tandem.example.com";

const DASH = "https://dash.cloudflare.com";
const ZERO_TRUST = "https://one.dash.cloudflare.com";

/**
 * Pages of the Cloudflare dashboard. With the tunnel known they open that account's page, or that tunnel's own;
 * without it they use Cloudflare's `?to=/:account/…` redirect, which asks for the account and then goes there.
 */
export const cloudflareLinks = {
  tunnels(tunnel?: TunnelIdentity): string {
    return tunnel === undefined ? `${DASH}/?to=/:account/tunnels` : `${DASH}/${tunnel.accountId}/tunnels`;
  },
  /** The tunnel's page, on the tab that lists its routes. */
  tunnelRoutes(tunnel?: TunnelIdentity): string {
    if (tunnel === undefined) return cloudflareLinks.tunnels();
    return `${ZERO_TRUST}/${tunnel.accountId}/networks/connectors/cloudflare-tunnels/cfd_tunnel/${tunnel.tunnelId}/edit?tab=publicHostname`;
  },
  accessApplications(tunnel?: TunnelIdentity): string {
    return tunnel === undefined
      ? `${ZERO_TRUST}/?to=/:account/access-controls/apps`
      : `${ZERO_TRUST}/${tunnel.accountId}/access-controls/apps`;
  },
};

/**
 * The connector token in what a person pasted: the token itself, or any of the commands Cloudflare shows with it
 * (`cloudflared service install <token>`, `… run --token <token>`, `--token=<token>`). `undefined` when no token can
 * be picked out of a command.
 */
export function pastedToken(text: string): string | undefined {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  if (words.length === 1) return words[0];
  for (const [index, word] of words.entries()) {
    if (word === "--token") return words[index + 1];
    if (word.startsWith("--token=")) return word.slice("--token=".length) || undefined;
  }
  const install = words.indexOf("install");
  if (install !== -1 && words[install - 1] === "service") return words[install + 1];
  return undefined;
}

/** The hostname of an address the page can use, or `undefined` while it is not an HTTPS origin yet. */
export function addressHostname(address: string): string | undefined {
  return validAddress(address) ? new URL(address.trim()).hostname : undefined;
}

/** An HTTPS origin and nothing else: no path, query, or port the route would not carry. */
export function validAddress(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname !== "" && url.origin === value.trim();
  } catch {
    return false;
  }
}

/**
 * How the dashboard asks for a hostname: a subdomain, and a domain chosen from the account's list. The first label
 * is the subdomain; the domain is a guess for names like `example.co.uk`, which the list corrects.
 */
export function splitHostname(hostname: string): { subdomain: string; domain: string } {
  const labels = hostname.split(".");
  if (labels.length <= 2) return { subdomain: "", domain: hostname };
  return { subdomain: labels[0] ?? "", domain: labels.slice(1).join(".") };
}
