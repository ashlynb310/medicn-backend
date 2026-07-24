import type { PriceUnit } from "@/lib/api/types";

/** Whole days between two ISO dates (min 1), matching the backend calc. */
export function nightsBetween(startDate: string, endDate: string) {
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  if (!Number.isFinite(ms) || ms <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

/**
 * Estimated total in cents using the same formula as
 * BookingsService.calculateTotalAmountCents. This is an ESTIMATE for display;
 * the authoritative total comes back on the created Booking.
 */
export function estimateTotalCents(
  priceCents: number,
  priceUnit: PriceUnit,
  startDate: string,
  endDate: string
) {
  const days = nightsBetween(startDate, endDate);
  if (days === 0) {
    return 0;
  }
  if (priceUnit === "month") {
    return priceCents * Math.ceil(days / 30);
  }
  return priceCents * days;
}
