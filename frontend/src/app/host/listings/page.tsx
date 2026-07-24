import type { Metadata } from "next";
import { SquarePlus } from "lucide-react";
import PageHeader from "@/components/layout/page-header";
import AuthGate from "@/components/auth/auth-gate";
import HostListingsList from "@/components/host/host-listings-list";
import { ButtonLink } from "@/components/ui/button-link";

export const metadata: Metadata = {
  title: "My Listings | The MediCN",
  description: "Manage the properties you host on The MediCN.",
};

// Wired to GET /api/v1/listings/mine (Phase 4.5): the host's own listings across
// all statuses, with status filter, pagination, and loading/empty/error states.
export default function HostListingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="My listings"
        description="Every property you host, with its review status."
        actions={
          <ButtonLink href="/host/listings/new">
            <SquarePlus aria-hidden="true" />
            New listing
          </ButtonLink>
        }
      />
      <AuthGate
        message="Sign in with a host account to view and manage your listings."
        returnTo="/host/listings"
      >
        <HostListingsList />
      </AuthGate>
    </div>
  );
}
