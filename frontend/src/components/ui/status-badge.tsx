import { Badge } from "@/components/ui/badge";

// Status values mirror the backend Prisma enums (see medicn/prisma/schema.prisma:
// BookingStatus and ListingStatus). Keep these in sync if the backend changes.

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

export type BookingStatus =
  | "requested"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "payment_pending"
  | "paid"
  | "completed";

export type ListingStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "hidden"
  | "archived";

const bookingStatusConfig: Record<
  BookingStatus,
  { label: string; tone: BadgeTone }
> = {
  requested: { label: "Requested", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  payment_pending: { label: "Payment pending", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  completed: { label: "Completed", tone: "accent" },
};

const listingStatusConfig: Record<
  ListingStatus,
  { label: string; tone: BadgeTone }
> = {
  draft: { label: "Draft", tone: "neutral" },
  pending: { label: "Pending review", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  hidden: { label: "Hidden", tone: "neutral" },
  archived: { label: "Archived", tone: "neutral" },
};

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

export function BookingStatusBadge({ status }: { status: string }) {
  const config = bookingStatusConfig[status as BookingStatus];
  return (
    <Badge tone={config?.tone ?? "neutral"}>
      {config?.label ?? humanize(status)}
    </Badge>
  );
}

export function ListingStatusBadge({ status }: { status: string }) {
  const config = listingStatusConfig[status as ListingStatus];
  return (
    <Badge tone={config?.tone ?? "neutral"}>
      {config?.label ?? humanize(status)}
    </Badge>
  );
}
