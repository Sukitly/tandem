import { describe, expect, test } from "vitest";
import { formatCacheHitPercent } from "../src/chat/cache-hit.ts";

/** As pi's `tps` extension does: the share of the prompt the provider read from its cache. */
function hit(input: number, cacheRead: number): string | null {
  return formatCacheHitPercent(cacheRead, input + cacheRead);
}

describe("the cache-hit percentage", () => {
  test("is absent when the run reported no prompt tokens", () => {
    expect(hit(0, 0)).toBeNull();
  });

  test("distinguishes full hits from near-full partial hits", () => {
    expect(hit(10, 0)).toBe("0");
    expect(hit(0, 10_000)).toBe("100");
    expect(hit(14, 986)).toBe("99");
    expect(hit(5, 995)).toBe("99.5");
    expect(hit(6, 9_994)).toBe("99.9");
    expect(hit(1, Number.MAX_SAFE_INTEGER - 1)).toBe("99.99999999999999");
  });
});
