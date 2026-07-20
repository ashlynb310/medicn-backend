import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PageContainer from "@/components/layout/page-container";
import CheckoutReturn from "@/components/checkout/checkout-return";

export const metadata: Metadata = {
  title: "Confirming Payment | The MediCN",
};

// Stripe redirects here as /checkout/success?session_id=...&bookingId=...
// We deliberately read ONLY bookingId (a non-authoritative locator) and never
// read, forward, or log session_id. Because Next serializes the URL query into
// the client router payload, we FIRST strip session_id with a server-side
// redirect so it never reaches the rendered HTML, client state, or logs.
// Arrival here is NOT proof of payment; the client component loads the protected
// booking/payment-summary and shows "Paid" only after the backend webhook.
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const raw = params.bookingId;
  const bookingId = (Array.isArray(raw) ? raw[0] : raw) ?? null;

  // Strip session_id (or any extra params) from the browser-visible URL.
  if ("session_id" in params) {
    redirect(bookingId ? `/checkout/success?bookingId=${encodeURIComponent(bookingId)}` : "/checkout/success");
  }

  return (
    <PageContainer width="narrow">
      <CheckoutReturn mode="success" bookingId={bookingId} />
    </PageContainer>
  );
}
