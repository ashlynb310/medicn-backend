import type { Metadata } from "next";
import { CircleCheckBig } from "lucide-react";
import PageContainer from "@/components/layout/page-container";
import { ButtonLink } from "@/components/ui/button-link";

export const metadata: Metadata = {
  title: "Payment Received | The MediCN",
};

// Stripe redirects here after checkout. The frontend must NOT claim the payment
// succeeded — the authoritative payment/booking status is confirmed by the
// backend Stripe webhook. So this page shows a "confirming" message and sends
// the user to their bookings to see the real status. No backend call, no faked
// success. `bookingId` is passed through only to link back to the booking.
export default async function CheckoutSuccessPage({
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
        <span className="flex size-14 items-center justify-center rounded-full bg-green-100 text-green-700">
          <CircleCheckBig className="size-7" aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Thanks — we&apos;re confirming your payment
        </h1>
        <p className="max-w-md text-sm text-slate-600">
          Your checkout is complete. We&apos;re finalizing the payment and will
          update your booking status shortly. You can track it from your
          bookings.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ButtonLink href={bookingHref}>View booking</ButtonLink>
          <ButtonLink href="/search" variant="outline">
            Keep browsing
          </ButtonLink>
        </div>
      </div>
    </PageContainer>
  );
}
