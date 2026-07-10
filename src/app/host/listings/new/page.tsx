import type { Metadata } from "next";
import PageHeader from "@/components/layout/page-header";
import AuthGate from "@/components/auth/auth-gate";
import ListingCreateForm from "@/components/host/listing-create-form";

export const metadata: Metadata = {
  title: "New Listing | The MediCN",
  description: "Create a new housing listing for medical professionals.",
};

// Auth is enforced via AuthGate. ListingCreateForm submits to POST
// /api/v1/listings and, on success, offers the presigned photo-upload flow.
// The backend requires a host-role account and returns the listing as
// "pending" review.
export default function NewListingPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Create a listing"
        description="Add your property so visiting medical professionals can find and book it."
      />
      <AuthGate
        message="Sign in with a host account to create a listing."
        returnTo="/host/listings/new"
      >
        <ListingCreateForm />
      </AuthGate>
    </div>
  );
}
