import type { Metadata } from "next";
import PageHeader from "@/components/layout/page-header";
import AuthGate from "@/components/auth/auth-gate";
import HostPayoutsPanel from "@/components/host/host-payouts-panel";
import { ButtonLink } from "@/components/ui/button-link";

export const metadata: Metadata = {
  title: "Payouts | The MediCN",
  description: "Set up and check your Stripe payout account for hosting.",
};

// Host payout setup wired to the backend Connect contracts. All identity and
// bank details are collected by Stripe's hosted onboarding — MediCN only sends
// the two-letter country code the backend DTO requires.
export default function HostPayoutsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Payouts"
        description="Set up how you get paid for confirmed bookings."
        actions={
          <ButtonLink href="/host" variant="outline">
            Host dashboard
          </ButtonLink>
        }
      />
      <AuthGate
        message="Sign in with a host account to set up payouts."
        returnTo="/host/payouts"
      >
        <HostPayoutsPanel />
      </AuthGate>
    </div>
  );
}
