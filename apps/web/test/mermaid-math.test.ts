// @vitest-environment jsdom

import { mermaid } from "@streamdown/mermaid";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

test.each([false, true])("real Mermaid math renders with patched KaTeX (legacy MathML: %s)", async (legacy) => {
  // jsdom lacks SVG layout and the browser's MathMLElement constructor. Emulate browser capabilities only;
  // the plugin, parser, sanitizer and math renderer are real. Legacy mode covers the fallback without native MathML.
  if (!legacy) vi.stubGlobal("MathMLElement", class extends Element {});
  const original = Object.getOwnPropertyDescriptor(SVGElement.prototype, "getBBox");
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 120, height: 40 }),
  });
  try {
    const renderer = mermaid.getMermaid({ startOnLoad: false, securityLevel: "strict", forceLegacyMathML: legacy });
    const { svg } = await renderer.render(
      "math-compatibility",
      'flowchart LR\n A["$$\\frac{1}{2} + \\sqrt{x}$$"] --> B["Result"]',
    );
    const diagram = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(diagram.querySelector("parsererror")).toBeNull();
    expect(diagram.querySelector("svg")).not.toBeNull();
    expect(diagram.querySelector(".katex")).not.toBeNull();
    expect(diagram.querySelector(".katex-error")).toBeNull();
    expect(diagram.querySelector("math")).not.toBeNull();
    expect(diagram.querySelector("mfrac")).not.toBeNull();
    expect(diagram.querySelector("msqrt")).not.toBeNull();
    expect(diagram.documentElement.textContent).toContain("Result");
  } finally {
    if (original === undefined) Reflect.deleteProperty(SVGElement.prototype, "getBBox");
    else Object.defineProperty(SVGElement.prototype, "getBBox", original);
  }
});
