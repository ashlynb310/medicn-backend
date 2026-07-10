import type { Metadata } from "next";
import PageContainer from "@/components/layout/page-container";
import PageHeader from "@/components/layout/page-header";
import AuthGate from "@/components/auth/auth-gate";
import BookingsList from "@/components/bookings/bookings-list";

export const metadata: Metadata = {
  title: "My Bookings | The MediCN",
  description: "View and manage your housing booking requests.",
};

// Auth is enforced via AuthGate (logged out -> SignInRequired). When signed in,
// BookingsList loads real data from GET /api/v1/bookings (renter + host
// bookings for the user) with loading/empty/error states.
export default function BookingsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="My Bookings"
        description="Track your booking requests and their status, from request through payment."
      />
      <AuthGate
        message="Sign in to see the bookings you have requested and any that hosts have accepted."
        returnTo="/bookings"
      >
        <BookingsList />
      </AuthGate>
    </PageContainer>
  );
}
