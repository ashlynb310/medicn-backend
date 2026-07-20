import type { Metadata } from "next";
import PageHeader from "@/components/layout/page-header";
import AuthGate from "@/components/auth/auth-gate";
import HostListingManage from "@/components/host/host-listing-manage";
import { ButtonLink } from "@/components/ui/button-link";

export const metadata: Metadata = {
  title: "Manage listing | The MediCN",
};

// Owner listing management: edit fields, manage photos, and manage availability.
// The listing is fetched client-side with the Host's bearer token (owner/admin
// projection), never through an anonymous-only public fetch — so non-approved
// listings load correctly for their owner.
export default async function HostListingManagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Manage listing"
        description="Update details, photos, and availability."
        actions={
          <ButtonLink href="/host/listings" variant="outline">
            My listings
          </ButtonLink>
        }
      />
      <AuthGate
        message="Sign in with a host account to manage this listing."
        returnTo={`/host/listings/${id}`}
      >
        <HostListingManage id={id} />
      </AuthGate>
    </div>
  );
}
