import type { Metadata } from "next";
import PageHeader from "@/components/layout/page-header";
import AuthGate from "@/components/auth/auth-gate";
import IdentityVerificationPanel from "@/components/identity/identity-verification-panel";
import { ButtonLink } from "@/components/ui/button-link";

export const metadata: Metadata = {
  title: "Identity Verification | The MediCN",
  description: "Verify your identity on The MediCN.",
};

// Wired to GET /api/v1/identity/verifications/current and
// POST /api/v1/identity/verifications/session. Identity only — healthcare
// credential verification is a separate workflow and is not touched here.
export default function IdentityVerificationPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Identity verification"
        description="Confirm your identity to unlock booking and hosting actions."
        actions={
          <ButtonLink href="/account" variant="outline">
            Back to profile
          </ButtonLink>
        }
      />
      <AuthGate
        message="Sign in to view and manage your identity verification."
        returnTo="/account/verification"
      >
        <IdentityVerificationPanel />
      </AuthGate>
    </div>
  );
}
