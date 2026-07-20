import {
  calculateHostReversalTarget,
  calculateMarketplaceAmounts
} from "../src/payments/marketplace-money";

describe("marketplace integer money calculations", () => {
  it("rounds a basis-point fee to nearest cent with half-cents up", () => {
    expect(calculateMarketplaceAmounts(10_005, 1250)).toEqual({
      grossAmountCents: 10_005,
      platformFeeCents: 1_251,
      hostNetAmountCents: 8_754
    });
  });

  it("calculates cumulative partial and full Host reversal targets", () => {
    expect(calculateHostReversalTarget(4_000, 16_000, 14_000)).toBe(3_500);
    expect(calculateHostReversalTarget(16_000, 16_000, 14_000)).toBe(14_000);
  });
});
