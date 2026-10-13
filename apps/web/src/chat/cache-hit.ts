/**
 * The cache-read share of a run's prompt tokens, in percent, as pi's `tps` extension formats it: the whole part while
 * a partial hit is closer to the previous whole percent, and a run that hit everything reads `100`, never
 * `99.9`-style rounding that would show 100% for a partial hit.
 */
export function formatCacheHitPercent(cacheRead: number, promptTokens: number): string | null {
  if (promptTokens === 0) return null;
  const missed = promptTokens - cacheRead;
  if (missed === 0) return "100";

  // Compare integer thresholds to avoid floating-point rounding near 100%.
  const quotient = Math.floor(promptTokens / 200);
  const remainder = promptTokens % 200;
  let lower = 0;
  let upper = 100;
  while (lower < upper) {
    const candidate = Math.floor((lower + upper + 1) / 2);
    const factor = candidate * 2 - 1;
    const threshold = factor * quotient + Math.ceil((factor * remainder) / 200);
    if (cacheRead >= threshold) lower = candidate;
    else upper = candidate - 1;
  }
  if (lower < 100) return String(lower);

  let places = 1;
  let scaledDoubleGap = missed * 200;
  const denominatorTens = Math.floor(promptTokens / 10);
  while (scaledDoubleGap <= denominatorTens) {
    scaledDoubleGap *= 10;
    places++;
  }
  const denominatorOnes = promptTokens % 10;
  let roundedLoss = 5;
  for (let loss = 1; loss < 5; loss++) {
    const factor = loss * 2 + 1;
    if (scaledDoubleGap <= factor * denominatorTens + Math.floor((factor * denominatorOnes) / 10)) {
      roundedLoss = loss;
      break;
    }
  }
  return `99.${"9".repeat(places - 1)}${10 - roundedLoss}`;
}
