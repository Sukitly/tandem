// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TerminalView } from "../src/terminals/terminal-view.tsx";

const mock = vi.hoisted(() => ({
  mobile: true,
  constructors: vi.fn(),
  dispose: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
  options: [] as Record<string, unknown>[],
}));
vi.mock("../src/hooks/use-mobile.ts", () => ({ useIsMobile: () => mock.mobile }));
vi.mock("../src/rpc/connection.tsx", () => ({ useConnected: () => ({ openTerminal: mock.open }) }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      mock.options.push(options);
      mock.constructors();
    }
    loadAddon() {}
    open() {}
    write() {}
    reset() {}
    resize() {}
    focus() {}
    onData() {
      return { dispose() {} };
    }
    onBinary() {
      return { dispose() {} };
    }
    dispose() {
      mock.dispose();
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    proposeDimensions() {
      return undefined;
    }
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  },
}));
beforeEach(() => {
  mock.mobile = true;
  mock.options = [];
  mock.open.mockImplementation(() => ({ close: mock.close, input() {}, inputBinary() {}, resize() {} }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("viewport breakpoints do not recreate a retained terminal or its transport", () => {
  const view = render(<TerminalView id="one" active={false} ended={false} />);
  mock.mobile = false;
  view.rerender(<TerminalView id="one" active={false} ended={false} />);
  mock.mobile = true;
  view.rerender(<TerminalView id="one" active={true} ended={false} />);
  expect(mock.constructors).toHaveBeenCalledOnce();
  expect(mock.open).toHaveBeenCalledOnce();
  expect(mock.close).not.toHaveBeenCalled();
  view.unmount();
  expect(mock.dispose).toHaveBeenCalledOnce();
  expect(mock.close).toHaveBeenCalledOnce();
});

test("recreating an ended terminal initializes its input and cursor state correctly", () => {
  const view = render(<TerminalView id="one" active={false} ended />);
  view.rerender(<TerminalView id="two" active={false} ended />);
  expect(mock.options).toHaveLength(2);
  for (const options of mock.options) expect(options).toMatchObject({ disableStdin: true, cursorBlink: false });
});
