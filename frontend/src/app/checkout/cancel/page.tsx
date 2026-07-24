import type { Metadata } from "next";
import PageContainer from "@/components/layout/page-container";
import CheckoutReturn from "@/components/checkout/checkout-return";

export const metadata: Metadata = {
  title: "Checkout | The MediCN",
};

// Stripe redirects here as /checkout/cancel?bookingId=... when the user leaves
// checkout. We do NOT claim "no payment was taken" — payment and redirect events
// can race — so the client loads the authoritative booking/payment status and
// offers retry only if the refreshed state remains eligible. bookingId is only a
// locator; a missing one falls back to /bookings.
export default async function CheckoutCancelPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const raw = params.bookingId;
  const bookingId = (Array.isArray(raw) ? raw[0] : raw) ?? null;

  return (
    <PageContainer width="narrow">
      <CheckoutReturn mode="cancel" bookingId={bookingId} />
    </PageContainer>
  );
}
