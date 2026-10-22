import { vi } from "vitest";

/**
 * What the message box asks of a browser and jsdom lacks: whether the main pointer is coarse, which tells a touch
 * screen, whose Enter breaks the line, and the size of an element. Call it in `beforeEach`; `vi.unstubAllGlobals()`
 * takes it away.
 */
export function stubBrowserForComposer({ touch = false }: { touch?: boolean } = {}): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: touch && query === "(pointer: coarse)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}
