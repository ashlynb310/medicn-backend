import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import PageContainer from "@/components/layout/page-container";
import PageHeader from "@/components/layout/page-header";
import AuthGate from "@/components/auth/auth-gate";
import BookingDetailPanel from "@/components/bookings/booking-detail-panel";
import { ButtonLink } from "@/components/ui/button-link";

export const metadata: Metadata = {
  title: "Booking Details | The MediCN",
};

// Auth is enforced via AuthGate. When signed in, BookingDetailPanel loads the
// booking from GET /api/v1/bookings/:id (the backend authorizes access to the
// booking's renter/host/admin only). Checkout is shown disabled until payment
// is implemented in a later phase.
export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="Booking details"
        eyebrow={
          <ButtonLink href="/bookings" variant="ghost" size="sm">
            <ChevronLeft aria-hidden="true" />
            Back to bookings
          </ButtonLink>
        }
      />
      <AuthGate
        message="Sign in to view the details and status of this booking."
        returnTo={`/bookings/${id}`}
      >
        <BookingDetailPanel bookingId={id} />
      </AuthGate>
    </PageContainer>
  );
}
