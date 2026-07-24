import type {
  ListingHostSummary,
  ListingType,
  PriceUnit,
  StayDuration,
} from "@/lib/api/types";

const priceUnitLabels: Record<PriceUnit, string> = {
  day: "day",
  night: "night",
  month: "month",
};

const stayDurationLabels: Record<StayDuration, string> = {
  short_term: "Short term",
  medium_term: "Medium term",
  long_term: "Long term",
};

const listingTypeLabels: Record<ListingType, string> = {
  private_room: "Private room",
  entire_home: "Entire home",
  shared_room: "Shared room",
};

export function formatPrice(priceCents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: priceCents % 100 === 0 ? 0 : 2,
    }).format(priceCents / 100);
  } catch {
    return `$${(priceCents / 100).toFixed(2)}`;
  }
}

export function formatPriceWithUnit(
  priceCents: number,
  currency: string,
  priceUnit: PriceUnit
) {
  return `${formatPrice(priceCents, currency)} / ${priceUnitLabels[priceUnit] ?? priceUnit}`;
}

export function formatStayDuration(value: StayDuration) {
  return stayDurationLabels[value] ?? value;
}

export function formatListingType(value: ListingType) {
  return listingTypeLabels[value] ?? value;
}

export function formatHostName(host: ListingHostSummary) {
  return host.displayName || host.firstName || "MediCN host";
}

export function formatDate(isoDate: string) {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatEnumLabel(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}
