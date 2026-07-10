import type { Metadata } from "next";
import { CircleX } from "lucide-react";
import PageContainer from "@/components/layout/page-container";
import { ButtonLink } from "@/components/ui/button-link";

export const metadata: Metadata = {
  title: "Checkout Cancelled | The MediCN",
};

// Stripe redirects here when the user cancels checkout. No payment was taken and
// the booking status is unchanged on the backend. `bookingId` is passed through
// only to offer a link back to retry from the booking.
export default async function CheckoutCancelPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const bookingId = Array.isArray(params.bookingId)
    ? params.bookingId[0]
    : params.bookingId;

  const bookingHref = bookingId ? `/bookings/${bookingId}` : "/bookings";

  return (
    <PageContainer width="narrow">
      <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <CircleX className="size-7" aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Checkout cancelled
        </h1>
        <p className="max-w-md text-sm text-slate-600">
          No payment was taken and your booking is unchanged. You can return to
          your booking to try again whenever you&apos;re ready.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ButtonLink href={bookingHref}>Back to booking</ButtonLink>
          <ButtonLink href="/search" variant="outline">
            Keep browsing
          </ButtonLink>
        </div>
      </div>
    </PageContainer>
  );
}
