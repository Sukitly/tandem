import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { createPublicAccessService } from "../src/services/public-access.ts";
import { loadTunnelConfig, tunnelConfigPath } from "../src/tunnel-config.ts";
import { type PublicAccessView, TunnelControl } from "../src/tunnel-control.ts";
import { tunnelFileYamlPath } from "../src/tunnel-file.ts";

const PUBLIC_URL = "https://tandem.example.com";
const TUNNEL_ID = "c4648dd8-acd3-48f5-9004-3f3dc20192c2";

/**
 * A stand-in for cloudflared that answers every subcommand and stays connected, so the whole publish path runs
 * without an account, a browser, or a network.
 */
async function bench() {
  const root = await mkdtemp(join(tmpdir(), "tandem-control-"));
  const home = join(root, "home");
  await mkdir(home, { recursive: true });
  const calls = join(root, "calls");
  const created = join(root, "created");
  const script = `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  *--version*) echo "cloudflared version 2026.10.0"; exit 0 ;;
esac
case "$1 $2" in
  "tunnel login")
    mkdir -p "$HOME/.cloudflared"
    printf 'origin certificate' > "$HOME/.cloudflared/cert.pem"
    echo "A browser window should have opened at the following URL:"
    echo "https://dash.cloudflare.com/argotunnel?x=1"
    echo "If the browser failed to open, please visit the URL above directly."
    ;;
  "tunnel list")
    [ -f "$CREATED" ] && printf '[{"id":"${TUNNEL_ID}","name":"tandem"}]' || printf '[]'
    ;;
  "tunnel create")
    printf 'Tunnel credentials written to $HOME/.cloudflared/${TUNNEL_ID}.json\\\\n'
    : > "$CREATED"
    ;;
  "tunnel route")
    echo "Added CNAME record"
    ;;
  *)
    case "$*" in
      *" run"*) echo "INF Registered tunnel connection connIndex=0"; sleep 30 ;;
      *) echo "unexpected: $*" >&2; exit 2 ;;
    esac
    ;;
esac
`;
  const executable = join(root, "cloudflared");
  await writeFile(executable, script);
  await chmod(executable, 0o755);
  vi.stubEnv("CALLS", calls);
  vi.stubEnv("CREATED", created);
  vi.stubEnv("HOME", home);
  const stateDir = join(root, "state");
  const lines: string[] = [];
  const control = new TunnelControl({ stateDir, executable, onLog: (line) => lines.push(line) });
  return { root, home, stateDir, executable, calls, lines, control };
}

/** Follows the state the way a page does, until a condition holds or time runs out. */
async function until(control: TunnelControl, done: (view: PublicAccessView) => boolean, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (done(control.view)) return control.view;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return control.view;
}

/** Publishes and waits for the tunnel to register, the way a page following the state would. */
async function settled(control: TunnelControl): Promise<string> {
  const view = await until(control, (candidate) => ["connected", "failed", "unavailable"].includes(candidate.status));
  return view.status;
}

test("publishes with no token: authorizes, creates, routes, and connects", { timeout: 20_000 }, async () => {
  const b = await bench();
  try {
    // Every view the page would see: the approval URL is one of them, and it is gone once the step is over.
    const views: PublicAccessView[] = [];
    const watching = b.control.onChange((view) => views.push(view));
    await b.control.publish({ publicUrl: PUBLIC_URL });
    expect(await settled(b.control)).toBe("connected");
    watching();
    const authorizing = views.find((view) => view.authorizationUrl !== undefined);
    expect(authorizing?.status).toBe("authorizing");
    expect(authorizing?.authorizationUrl).toBe("https://dash.cloudflare.com/argotunnel?x=1");
    expect(b.control.tunnelState()).toBe("connected");
    expect(b.control.view.publicUrl).toBe(PUBLIC_URL);
    // No token exists on this path: the configuration is the file cloudflared reads.
    expect(await loadTunnelConfig(b.stateDir)).toEqual({ publicUrl: PUBLIC_URL });
    const yaml = await readFile(tunnelFileYamlPath(b.stateDir), "utf8");
    expect(yaml).toContain(`credentials-file: ${join(b.home, ".cloudflared", `${TUNNEL_ID}.json`)}`);
    await b.control.stop();
  } finally {
    await b.control.stop();
  }
});

test("resumes what is already configured when the server starts", { timeout: 20_000 }, async () => {
  const b = await bench();
  try {
    await b.control.publish({ publicUrl: PUBLIC_URL });
    await settled(b.control);
    await b.control.stop();

    const resumed = new TunnelControl({ stateDir: b.stateDir, executable: b.executable, onLog: () => {} });
    expect(resumed.view.status).toBe("none");
    await resumed.resume();
    expect(await settled(resumed)).toBe("connected");
    await resumed.stop();
  } finally {
    await b.control.stop();
  }
});

test("stops publishing here and leaves nothing configured", { timeout: 20_000 }, async () => {
  const b = await bench();
  try {
    await b.control.publish({ publicUrl: PUBLIC_URL });
    await settled(b.control);
    await b.control.unpublish();
    expect(b.control.view.status).toBe("none");
    expect(b.control.tunnelState()).toBeUndefined();
    expect(await stat(tunnelFileYamlPath(b.stateDir)).catch(() => undefined)).toBeUndefined();
    expect(await stat(tunnelConfigPath(b.stateDir)).catch(() => undefined)).toBeUndefined();
  } finally {
    await b.control.stop();
  }
});

test("says which program to install instead of failing silently", { timeout: 20_000 }, async () => {
  const b = await bench();
  try {
    const control = new TunnelControl({
      stateDir: b.stateDir,
      executable: join(b.root, "no-such-cloudflared"),
      onLog: () => {},
    });
    expect(control.cloudflared).toBe(false);
    await control.publish({ publicUrl: PUBLIC_URL });
    expect(await settled(control)).toBe("failed");
    expect(control.view.message).toContain("brew install cloudflared");
    await control.stop();
  } finally {
    await b.control.stop();
  }
});

test("takes one publish at a time", { timeout: 20_000 }, async () => {
  const b = await bench();
  try {
    await b.control.publish({ publicUrl: PUBLIC_URL });
    await expect(b.control.publish({ publicUrl: PUBLIC_URL })).rejects.toThrow(/already being set up/);
    await settled(b.control);
  } finally {
    await b.control.stop();
  }
});

test("the service publishes through the control and refuses an origin it cannot publish at", {
  timeout: 20_000,
}, async () => {
  const b = await bench();
  try {
    const service = createPublicAccessService(b.control);
    const view = () => service.state.value ?? { status: "none", cloudflared: true };
    expect(service.state.value).toEqual({ status: "none", cloudflared: true });
    await expect(service.publish({ publicUrl: "http://tandem.example.com" }, {} as never)).rejects.toThrow(
      /HTTPS origin/,
    );
    expect(b.control.view.status).toBe("none");
    await service.publish({ publicUrl: PUBLIC_URL }, {} as never);
    expect(await settled(b.control)).toBe("connected");
    // The control's view is what the page reads, so the service replicates it.
    expect(view().status).toBe("connected");
    expect(view().publicUrl).toBe(PUBLIC_URL);
    await service.unpublish({} as never);
    expect(view().status).toBe("none");
  } finally {
    await b.control.stop();
  }
});

test("publishes with a dashboard token, and needs no authorization for it", { timeout: 20_000 }, async () => {
  const b = await bench();
  try {
    await b.control.publish({ publicUrl: PUBLIC_URL, token: "dashboard-token" });
    expect(await settled(b.control)).toBe("connected");
    // The token runs that one tunnel and grants nothing else, so nothing was created or authorized here.
    const calls = await readFile(b.calls, "utf8");
    expect(calls).not.toContain("tunnel login");
    expect(calls).not.toContain("tunnel create");
    expect(await loadTunnelConfig(b.stateDir)).toEqual({ publicUrl: PUBLIC_URL, token: "dashboard-token" });
    // No file a self-managed tunnel reads, because the token is what runs this one.
    expect(await stat(tunnelFileYamlPath(b.stateDir)).catch(() => undefined)).toBeUndefined();
  } finally {
    await b.control.stop();
  }
});

test("a token replaces a self-managed configuration rather than losing to it", { timeout: 20_000 }, async () => {
  const b = await bench();
  try {
    await b.control.publish({ publicUrl: PUBLIC_URL });
    await settled(b.control);
    expect((await stat(tunnelFileYamlPath(b.stateDir))).isFile()).toBe(true);
    await b.control.publish({ publicUrl: PUBLIC_URL, token: "dashboard-token" });
    expect(await settled(b.control)).toBe("connected");
    expect(await stat(tunnelFileYamlPath(b.stateDir)).catch(() => undefined)).toBeUndefined();
    expect(await loadTunnelConfig(b.stateDir)).toEqual({ publicUrl: PUBLIC_URL, token: "dashboard-token" });
    expect(b.lines.join("\n")).toContain("Replaced");
  } finally {
    await b.control.stop();
  }
});

test("the service refuses an empty token rather than publishing with it", { timeout: 20_000 }, async () => {
  const b = await bench();
  try {
    const service = createPublicAccessService(b.control);
    await expect(service.publish({ publicUrl: PUBLIC_URL, token: "  " }, {} as never)).rejects.toThrow(
      /token is not valid/,
    );
    expect(b.control.view.status).toBe("none");
  } finally {
    await b.control.stop();
  }
});
