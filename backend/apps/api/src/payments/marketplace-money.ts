export interface MarketplaceAmounts {
  grossAmountCents: number;
  platformFeeCents: number;
  hostNetAmountCents: number;
}

/** Rounds the percentage fee to the nearest cent, with exact half-cents rounded up. */
export function calculateMarketplaceAmounts(
  grossAmountCents: number,
  platformFeeBps: number
): MarketplaceAmounts {
  if (
    !Number.isSafeInteger(grossAmountCents) ||
    grossAmountCents <= 0 ||
    !Number.isInteger(platformFeeBps) ||
    platformFeeBps < 0 ||
    platformFeeBps > 9_999
  ) {
    throw new Error("Invalid marketplace fee inputs.");
  }

  const platformFeeCents = Math.floor(
    (grossAmountCents * platformFeeBps + 5_000) / 10_000
  );
  return {
    grossAmountCents,
    platformFeeCents,
    hostNetAmountCents: grossAmountCents - platformFeeCents
  };
}

/** Calculates the cumulative Host share of a cumulative gross refund. */
export function calculateHostReversalTarget(
  refundedGrossAmountCents: number,
  grossAmountCents: number,
  hostNetAmountCents: number
) {
  if (refundedGrossAmountCents >= grossAmountCents) {
    return hostNetAmountCents;
  }
  return Math.min(
    hostNetAmountCents,
    Math.floor(
      (refundedGrossAmountCents * hostNetAmountCents +
        Math.floor(grossAmountCents / 2)) /
        grossAmountCents
    )
  );
}
