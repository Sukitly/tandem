// @vitest-environment jsdom

import { createRemoteServiceBinding, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type ConnectionStatus, connect } from "@tandem/client";
import { PublicAccess } from "@tandem/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { ConnectionProvider, useConnected } from "../src/rpc/connection.tsx";

vi.mock("@tandem/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tandem/client")>()),
  connect: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function ConnectedPage() {
  const { publicAccess, usage, repository } = useConnected();
  expect(publicAccess).toBeDefined();
  expect(usage).toBeDefined();
  expect(repository).toBeDefined();
  return createElement("div", null, "Connected");
}

test("registers every service used during page connection, including public access", async () => {
  const close = vi.fn();
  vi.mocked(connect).mockImplementation(async (options) => {
    // Use the real allowlist checks without opening a network connection.
    const services = createRemoteServiceBinding({
      services: options.services,
      bound: false,
      transport: { invoke: vi.fn(), subscribe: vi.fn() },
    });
    close.mockImplementation(() => services.dispose(BACKGROUND_CONTEXT));
    return {
      services,
      status: replicatedState<ConnectionStatus>({ status: "connected" }),
      terminal: vi.fn(),
      image: vi.fn(),
      imageUrl: vi.fn(),
      close,
    };
  });

  const page = render(
    createElement(ConnectionProvider, {
      fallback: (state) => createElement("div", null, state.kind),
      // biome-ignore lint/correctness/noChildrenProp: createElement requires the provider's mandatory children prop.
      children: createElement(ConnectedPage),
    }),
  );

  await screen.findByText("Connected");
  expect(vi.mocked(connect).mock.calls[0]?.[0].services).toContain(PublicAccess);
  page.unmount();
  expect(close).toHaveBeenCalledTimes(1);
});
