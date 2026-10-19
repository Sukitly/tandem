import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { runTunnel } from "../src/tunnel-command.ts";
import { loadTunnelConfig } from "../src/tunnel-config.ts";
import { originCertPath, tunnelFileYamlPath } from "../src/tunnel-file.ts";
import { createTunnelHere, setupTunnel } from "../src/tunnel-setup.ts";

const PUBLIC_URL = "https://tandem.example.com";
const TUNNEL_ID = "c4648dd8-acd3-48f5-9004-3f3dc20192c2";

interface Bench {
  readonly home: string;
  readonly root: string;
  readonly state: string;
  readonly executable: string;
  readonly calls: string;
  readonly cert: string;
  /** Whether the DNS route command reports that a record is already there. */
  readonly refuseDns: string;
  /** Whether the tunnel has been created yet; `list` answers differently before and after. */
  readonly created: string;
}

/**
 * A stand-in for cloudflared that answers each subcommand the way the real one does, so that the whole setup runs
 * without an account, a browser, or a network.
 */
async function bench(): Promise<Bench> {
  const root = await mkdtemp(join(tmpdir(), "tandem-setup-"));
  const home = join(root, "home");
  await mkdir(home, { recursive: true });
  const calls = join(root, "calls");
  const cert = originCertPath(home);
  const refuseDns = join(root, "refuse-dns");
  const created = join(root, "created");
  const script = `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
case "$1 $2" in
  "tunnel login")
    mkdir -p "$(dirname "$CERT")"
    printf 'origin certificate' > "$CERT"
    echo "INF Added cert.pem"
    ;;
  "tunnel list")
    if [ ! -f "$CERT" ]; then echo "Cannot determine the origin certificate" >&2; exit 1; fi
    [ -f "$CREATED" ] && printf '[{"id":"${TUNNEL_ID}","name":"tandem"}]\\n' || printf '[]\\n'
    ;;
  "tunnel create")
    printf 'Tunnel credentials written to $HOME/.cloudflared/${TUNNEL_ID}.json\\n'
    : > "$CREATED"
    ;;
  "tunnel route")
    case "$*" in
      *--overwrite-dns*) ;;
      *) if [ -f "$REFUSE_DNS" ]; then
           echo "Failed to add route: record with that host already exists" >&2
           exit 1
         fi ;;
    esac
    echo "Added CNAME record"
    ;;
  "tunnel token")
    printf 'eyJhIjoi-connector-token'
    ;;
  *) echo "unexpected: $*" >&2; exit 2 ;;
esac
`;
  const executable = join(root, "cloudflared");
  await writeFile(executable, script);
  await chmod(executable, 0o755);
  vi.stubEnv("CALLS", calls);
  vi.stubEnv("CERT", cert);
  vi.stubEnv("REFUSE_DNS", refuseDns);
  vi.stubEnv("CREATED", created);
  vi.stubEnv("HOME", home);
  return { home, root, state: join(root, "state"), executable, calls, cert, refuseDns, created };
}

test("setup authorizes, creates the tunnel, routes the hostname, and writes both files", {
  timeout: 20_000,
}, async () => {
  const b = await bench();
  const lines: string[] = [];
  const result = await setupTunnel({
    publicUrl: PUBLIC_URL,
    stateDir: b.state,
    executable: b.executable,
    report: (line) => lines.push(line),
  });

  expect(result.tunnelId).toBe(TUNNEL_ID);
  expect(await loadTunnelConfig(b.state)).toEqual({ publicUrl: PUBLIC_URL });
  const yaml = await readFile(tunnelFileYamlPath(b.state), "utf8");
  expect(yaml).toContain(`tunnel: ${TUNNEL_ID}`);
  expect(yaml).toContain(`credentials-file: ${join(b.home, ".cloudflared", `${TUNNEL_ID}.json`)}`);
  expect(yaml).toContain("hostname: tandem.example.com");
  expect(yaml).toContain("service: http://127.0.0.1:4820");
  expect(yaml).toContain("service: http_status:404");
  expect((await stat(tunnelFileYamlPath(b.state))).isFile()).toBe(true);

  const calls = await readFile(b.calls, "utf8");
  expect(calls).toContain("tunnel login");
  expect(calls).toContain("tunnel create tandem");
  expect(calls).toContain(`tunnel route dns ${TUNNEL_ID} tandem.example.com`);
  expect(lines.join("\n")).toContain("tandem.example.com now points at this tunnel.");
});

test("setup skips the browser when this machine is already authorized", { timeout: 20_000 }, async () => {
  const b = await bench();
  await mkdir(join(b.home, ".cloudflared"), { recursive: true });
  await writeFile(b.cert, "already authorized");
  await setupTunnel({ publicUrl: PUBLIC_URL, stateDir: b.state, executable: b.executable, report: () => {} });
  expect(await readFile(b.calls, "utf8")).not.toContain("tunnel login");
});

test("setup refuses to replace an existing DNS record unless told to", { timeout: 20_000 }, async () => {
  const b = await bench();
  await writeFile(b.refuseDns, "1");
  await expect(
    setupTunnel({ publicUrl: PUBLIC_URL, stateDir: b.state, executable: b.executable, report: () => {} }),
  ).rejects.toThrow(/already has a DNS record.*--force/);
  // Nothing was written, so a refused setup changes nothing.
  expect(await stat(tunnelFileYamlPath(b.state)).catch(() => undefined)).toBeUndefined();
  expect(await loadTunnelConfig(b.state)).toBeUndefined();

  await setupTunnel({
    publicUrl: PUBLIC_URL,
    stateDir: b.state,
    executable: b.executable,
    force: true,
    report: () => {},
  });
  expect(await readFile(b.calls, "utf8")).toContain("tunnel route dns --overwrite-dns");
});

test("setup names the program to install when there is none", { timeout: 20_000 }, async () => {
  const b = await bench();
  await expect(
    setupTunnel({
      publicUrl: PUBLIC_URL,
      stateDir: b.state,
      executable: join(b.home, "no-such-cloudflared"),
      report: () => {},
    }),
  ).rejects.toThrow(/not installed.*brew install cloudflared/);
});

test("setup refuses an origin that could not carry a Secure cookie", { timeout: 20_000 }, async () => {
  const b = await bench();
  await expect(
    setupTunnel({
      publicUrl: "http://tandem.example.com",
      stateDir: b.state,
      executable: b.executable,
      report: () => {},
    }),
  ).rejects.toThrow(/HTTPS origin/);
});

test("the command does the same thing, with no flags beyond the origin", { timeout: 20_000 }, async () => {
  const b = await bench();
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
  const search = `${b.root}:${process.env.PATH ?? ""}`;
  vi.stubEnv("PATH", search);
  try {
    await runTunnel(["setup", "--public-url", PUBLIC_URL], b.state, {
      serviceFile: join(b.root, "no-such-service-file"),
      reload: async () => 0,
    });
  } finally {
    vi.restoreAllMocks();
  }
  expect(await loadTunnelConfig(b.state)).toEqual({ publicUrl: PUBLIC_URL });
  expect(lines.join("\n")).toContain(`Tunnel ${TUNNEL_ID} is ready.`);
  // The origin is the only thing the person supplies: the tool is found on PATH, as the server would find it.
  expect(await readFile(b.calls, "utf8")).toContain("tunnel create tandem");
});

test("create hands back the token and writes nothing on this machine", { timeout: 20_000 }, async () => {
  const b = await bench();
  const result = await createTunnelHere({ publicUrl: PUBLIC_URL, executable: b.executable, report: () => {} });
  expect(result.tunnelId).toBe(TUNNEL_ID);
  expect(result.token).toBe("eyJhIjoi-connector-token");
  // The point of this role: the authority stays here and the token goes there, so nothing local is written.
  expect(await stat(tunnelFileYamlPath(b.state)).catch(() => undefined)).toBeUndefined();
  expect(await loadTunnelConfig(b.state)).toBeUndefined();
  const calls = await readFile(b.calls, "utf8");
  expect(calls).toContain(`tunnel token ${TUNNEL_ID}`);
  expect(calls).not.toContain("tunnel --config");
});
