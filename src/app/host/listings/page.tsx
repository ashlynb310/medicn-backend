import type { Metadata } from "next";
import { List, SquarePlus } from "lucide-react";
import PageHeader from "@/components/layout/page-header";
import AuthGate from "@/components/auth/auth-gate";
import EmptyState from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";

export const metadata: Metadata = {
  title: "My Listings | The MediCN",
  description: "Manage the properties you host on The MediCN.",
};

// BLOCKED BY BACKEND: there is no host-owned listings endpoint. GET
// /api/v1/listings only returns APPROVED listings and has no hostId filter, and
// GET /api/v1/listings/:id only returns approved listings — so a host's own
// pending/draft listings cannot be fetched or listed. Rather than show the
// wrong data (all approved listings) or fake it, this page stays an honest
// empty state until a backend "my listings" endpoint exists.
export default function HostListingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="My listings"
        description="Every property you host, with its review status and booking activity."
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
        <EmptyState
          icon={List}
          title="Listing management isn't available yet"
          description="You can create a listing now, but the backend does not yet provide a way to list your own properties here. Once a host listings endpoint exists, your listings and their review status will appear on this page."
          action={
            <ButtonLink href="/host/listings/new">
              <SquarePlus aria-hidden="true" />
              Create a listing
            </ButtonLink>
          }
        />
      </AuthGate>
    </div>
  );
}
