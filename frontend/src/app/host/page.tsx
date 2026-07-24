import type { Metadata } from "next";
import { CalendarDays, List, SquarePlus } from "lucide-react";
import PageHeader from "@/components/layout/page-header";
import SectionHeading from "@/components/layout/section-heading";
import AuthGate from "@/components/auth/auth-gate";
import EmptyState from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Host Dashboard | The MediCN",
  description: "Manage your MediCN housing listings and booking requests.",
};

// No host-stats endpoints exist, so this dashboard shows no fabricated numbers.
// Incoming booking requests for a host ARE available via GET /api/v1/bookings
// (surfaced on /bookings), so we link there. A host-owned listings endpoint is
// still missing (see /host/listings), so listing counts are not shown.
export default function HostOverviewPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Host dashboard"
        description="List your property for visiting medical professionals and manage incoming booking requests."
        actions={
          <ButtonLink href="/host/listings/new">
            <SquarePlus aria-hidden="true" />
            New listing
          </ButtonLink>
        }
      />

      <AuthGate
        message="Sign in with a host account to view your listings and booking activity."
        returnTo="/host"
      >
        <EmptyState
          icon={CalendarDays}
          title="Manage your hosting activity"
          description="Create a listing to start hosting. Booking requests from renters appear in your bookings, where you can review each request and its status."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/host/listings/new">
                <SquarePlus aria-hidden="true" />
                Create a listing
              </ButtonLink>
              <ButtonLink href="/bookings" variant="outline">
                <CalendarDays aria-hidden="true" />
                View booking requests
              </ButtonLink>
            </div>
          }
        />
      </AuthGate>

      <section className="flex flex-col gap-4">
        <SectionHeading
          title="How hosting works"
          description="Three steps from listing to a confirmed stay."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              step: "1",
              title: "Create a listing",
              body: "Add photos, pricing, availability, and nearby hospitals so renters can find you.",
            },
            {
              step: "2",
              title: "Review requests",
              body: "Medical professionals send booking requests with their dates and needs.",
            },
            {
              step: "3",
              title: "Confirm and get paid",
              body: "Accept a request and the renter completes secure checkout for the stay.",
            },
          ].map((item) => (
            <Card key={item.step}>
              <CardContent className="flex flex-col gap-2 pt-2">
                <span className="flex size-8 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
                  {item.step}
                </span>
                <h3 className="text-base font-semibold text-slate-900">
                  {item.title}
                </h3>
                <p className="text-sm text-slate-600">{item.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <div>
          <ButtonLink href="/host/listings" variant="outline">
            <List aria-hidden="true" />
            View my listings
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
