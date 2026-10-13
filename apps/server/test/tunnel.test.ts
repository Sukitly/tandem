import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TunnelState } from "@tandem/contracts";
import { expect, test, vi } from "vitest";
import { runTunnel } from "../src/tunnel-command.ts";
import { loadTunnelConfig, saveTunnelConfig, tunnelConfigPath } from "../src/tunnel-config.ts";
import { tunnelFileYaml, tunnelFileYamlPath } from "../src/tunnel-file.ts";
import { startTunnel, tunnelInvocation } from "../src/tunnel-runner.ts";

const CONFIG = { publicUrl: "https://tandem.example.com", token: "secret-token-value" };

/** A stand-in for cloudflared, so that no test needs the real one or a Cloudflare account. */
async function standIn(body: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tandem-cloudflared-"));
  const path = join(root, "cloudflared");
  await writeFile(path, `#!/bin/sh\nprintf '%s\\n' "$@" > "$ARGS_FILE"\nenv > "$ENV_FILE"\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

/** Records where every line the runner logs goes, and waits for a state other than `starting`. */
async function supervise(executable: string, stateDir?: string) {
  const root = await mkdtemp(join(tmpdir(), "tandem-tunnel-"));
  const files = { ARGS_FILE: join(root, "args"), ENV_FILE: join(root, "env") };
  vi.stubEnv("ARGS_FILE", files.ARGS_FILE);
  vi.stubEnv("ENV_FILE", files.ENV_FILE);
  const lines: string[] = [];
  const runner = startTunnel(CONFIG, {
    onLog: (line) => lines.push(line),
    executable,
    stateDir: stateDir ?? join(root, "state"),
  });
  const until = async (state: TunnelState, deadline = Date.now() + 10_000): Promise<TunnelState> => {
    while (runner.state() !== state) {
      if (Date.now() > deadline) return runner.state();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return runner.state();
  };
  return { runner, lines, ...files, until };
}

test("keeps the public origin and the token at 0600, and reads them back", async () => {
  const state = await mkdtemp(join(tmpdir(), "tandem-state-"));
  expect(await loadTunnelConfig(state)).toBeUndefined();
  const path = await saveTunnelConfig(CONFIG, state);
  expect(path).toBe(tunnelConfigPath(state));
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await loadTunnelConfig(state)).toEqual(CONFIG);
});

test("refuses a public origin that could not carry a Secure cookie", async () => {
  const state = await mkdtemp(join(tmpdir(), "tandem-state-"));
  await expect(saveTunnelConfig({ ...CONFIG, publicUrl: "http://tandem.example.com" }, state)).rejects.toThrow(
    /must be an HTTPS origin/,
  );
  await expect(saveTunnelConfig({ ...CONFIG, token: "  " }, state)).rejects.toThrow(/token is empty/);
});

test("reads a configuration with no token, which is one this machine manages itself", async () => {
  const state = await mkdtemp(join(tmpdir(), "tandem-state-"));
  await writeFile(tunnelConfigPath(state), JSON.stringify({ publicUrl: CONFIG.publicUrl }));
  expect(await loadTunnelConfig(state)).toEqual({ publicUrl: CONFIG.publicUrl });
});

test("refuses a stored configuration with no public origin", async () => {
  const state = await mkdtemp(join(tmpdir(), "tandem-state-"));
  await writeFile(tunnelConfigPath(state), JSON.stringify({ token: CONFIG.token }));
  await expect(loadTunnelConfig(state)).rejects.toThrow(/needs a publicUrl/);
});

test("reports connected once cloudflared registers a connection", { timeout: 20_000 }, async () => {
  const executable = await standIn('echo "INF Registered tunnel connection connIndex=0"\nsleep 30');
  const supervised = await supervise(executable);
  try {
    expect(await supervised.until("connected")).toBe("connected");
  } finally {
    await supervised.runner.stop();
  }
});

test("carries the token in the environment, never in the arguments, and keeps the origin hop off any proxy", {
  timeout: 10_000,
}, async () => {
  vi.stubEnv("NO_PROXY", "example.com");
  const executable = await standIn('echo "INF Registered tunnel connection connIndex=0"\nsleep 30');
  const supervised = await supervise(executable);
  try {
    expect(await supervised.until("connected")).toBe("connected");
    const args = await readFile(supervised.ARGS_FILE, "utf8");
    expect(args).not.toContain(CONFIG.token);
    expect(args.split("\n")).toContain("--no-autoupdate");
    const environment = await readFile(supervised.ENV_FILE, "utf8");
    expect(environment).toContain(`TUNNEL_TOKEN=${CONFIG.token}`);
    expect(environment).toContain("NO_PROXY=example.com,127.0.0.1,localhost");
    // Whatever the installing shell had comes first; the hop to this machine is always excluded.
    expect(environment).toMatch(/^no_proxy=.*127\.0\.0\.1,localhost$/m);
  } finally {
    await supervised.runner.stop();
  }
});

test("reports failed, and keeps trying, when cloudflared exits", { timeout: 20_000 }, async () => {
  const executable = await standIn("exit 3");
  const supervised = await supervise(executable);
  try {
    expect(await supervised.until("failed")).toBe("failed");
    expect(supervised.lines.join("\n")).toContain("Trying again in 5s");
  } finally {
    await supervised.runner.stop();
  }
});

test("reports unavailable rather than retrying forever when cloudflared is not installed", {
  timeout: 10_000,
}, async () => {
  const supervised = await supervise(join(tmpdir(), "tandem-no-such-cloudflared"));
  try {
    expect(await supervised.until("unavailable")).toBe("unavailable");
    expect(supervised.lines.join("\n")).toContain("is not installed");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(supervised.lines.join("\n")).not.toContain("Trying again");
  } finally {
    await supervised.runner.stop();
  }
});

test("stops the tunnel it started", { timeout: 20_000 }, async () => {
  const executable = await standIn('echo "INF Registered tunnel connection connIndex=0"\nsleep 30');
  const supervised = await supervise(executable);
  expect(await supervised.until("connected")).toBe("connected");
  await supervised.runner.stop();
  await expect(supervised.runner.stop()).resolves.toBeUndefined();
  vi.unstubAllEnvs();
});

/** No test may look at the real service file: one that did once reloaded a running service. */
function isolated(root: string) {
  const reloads: number[] = [];
  return {
    reloads,
    options: {
      serviceFile: join(root, "no-such-service-file"),
      reload: async () => {
        reloads.push(1);
        return 0;
      },
    },
  };
}

test("configure reads the token from a file, and refuses to guess the public origin", { timeout: 20_000 }, async () => {
  const state = await mkdtemp(join(tmpdir(), "tandem-state-"));
  const root = await mkdtemp(join(tmpdir(), "tandem-token-"));
  const tokenFile = join(root, "token");
  await writeFile(tokenFile, `  ${CONFIG.token}\n`);
  const isolated1 = isolated(root);
  await expect(runTunnel(["configure", "--token-file", tokenFile], state, isolated1.options)).rejects.toThrow(
    /needs --public-url/,
  );
  await runTunnel(["configure", "--public-url", CONFIG.publicUrl, "--token-file", tokenFile], state, isolated1.options);
  expect(await loadTunnelConfig(state)).toEqual(CONFIG);
  // No service is installed where this test looks, so nothing was reloaded.
  expect(isolated1.reloads).toHaveLength(0);
});

test("configure reloads an installed service, so that one command leaves the tunnel running", {
  timeout: 20_000,
}, async () => {
  const state = await mkdtemp(join(tmpdir(), "tandem-state-"));
  const root = await mkdtemp(join(tmpdir(), "tandem-token-"));
  const tokenFile = join(root, "token");
  await writeFile(tokenFile, `${CONFIG.token}\n`);
  const serviceFile = join(root, "com.tandem.server.plist");
  await writeFile(serviceFile, "installed");
  const reloads: number[] = [];
  await runTunnel(["configure", "--public-url", CONFIG.publicUrl, "--token-file", tokenFile], state, {
    serviceFile,
    reload: async () => {
      reloads.push(1);
      return 0;
    },
  });
  expect(reloads).toHaveLength(1);
});

test("status says so when nothing is configured", { timeout: 20_000 }, async () => {
  const state = await mkdtemp(join(tmpdir(), "tandem-state-"));
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
  try {
    await runTunnel(["status"], state, isolated(state).options);
  } finally {
    vi.restoreAllMocks();
  }
  expect(lines.join("\n")).toContain(`No tunnel: ${tunnelConfigPath(state)} does not exist.`);
});

test("runs from the configuration this machine wrote, and otherwise from a token", async () => {
  const state = await mkdtemp(join(tmpdir(), "tandem-state-"));
  expect(tunnelInvocation({ publicUrl: CONFIG.publicUrl, token: CONFIG.token }, state)).toEqual({
    args: ["tunnel", "--no-autoupdate", "run"],
    env: { TUNNEL_TOKEN: CONFIG.token },
  });
  const file = tunnelFileYamlPath(state);
  await writeFile(file, tunnelFileYaml({ tunnelId: "id", credentialsFile: "/creds.json", hostname: "h" }));
  expect(tunnelInvocation({ publicUrl: CONFIG.publicUrl, token: CONFIG.token }, state)).toEqual({
    args: ["tunnel", "--config", file, "--no-autoupdate", "run"],
    env: {},
  });
  const empty = await mkdtemp(join(tmpdir(), "tandem-state-"));
  expect(() => tunnelInvocation({ publicUrl: CONFIG.publicUrl }, empty)).toThrow(/No tunnel to run/);
});
