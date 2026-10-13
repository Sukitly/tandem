import { afterEach, expect, test, vi } from "vitest";
import { runningPair } from "../src/launch.ts";
import { printInstalledPairing, printServicePairing } from "../src/service-pair.ts";

vi.mock("../src/launch.ts", async (original) => ({
  ...(await original<typeof import("../src/launch.ts")>()),
  runningPair: vi.fn(),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(runningPair).mockReset();
  process.exitCode = 0;
});
const base = new URL("http://127.0.0.1:4820");

test("prints local and remote links from the verified server without opening a browser", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(runningPair).mockResolvedValue({
    code: "one-use",
    expiresAt: Date.now() + 300_000,
    publicUrl: "https://tandem.example.com",
  });
  await printInstalledPairing(base);
  expect(runningPair).toHaveBeenCalledWith(base);
  expect(output.mock.calls.flat().join("\n")).toContain("http://127.0.0.1:4820/pair#one-use");
  expect(output.mock.calls.flat().join("\n")).toContain("https://tandem.example.com/pair#one-use");
  expect(output.mock.calls.flat().join("\n")).toContain("For a new link: bun run service pair");
});

test("standalone pairing fails when the server cannot be verified", async () => {
  vi.mocked(runningPair).mockResolvedValue(undefined);
  await expect(printServicePairing(base)).rejects.toThrow("Cannot verify the running Tandem");
});

test("reports pairing failure separately after successful installation", async () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(runningPair).mockRejectedValue(new Error("request failed"));
  await printInstalledPairing(base);
  expect(output.mock.calls.flat().join("\n")).toContain("The service is running, but generating a pairing link failed");
  expect(output.mock.calls.flat().join("\n")).toContain("bun run service pair");
  expect(process.exitCode).toBe(1);
});
