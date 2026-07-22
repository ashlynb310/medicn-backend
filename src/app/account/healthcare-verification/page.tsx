import type { Metadata } from "next";
import PageHeader from "@/components/layout/page-header";
import AuthGate from "@/components/auth/auth-gate";
import HealthcareVerificationPanel from "@/components/healthcare/healthcare-verification-panel";
import { ButtonLink } from "@/components/ui/button-link";

export const metadata: Metadata = {
  title: "Healthcare Credentials | The MediCN",
  description: "Submit healthcare credential evidence for review on The MediCN.",
};

// Subject-side healthcare credential workflow (GET/POST /healthcare-verifications).
// Entirely separate from Veriff identity verification, which stays at
// /account/verification. Gated behind NEXT_PUBLIC_HEALTHCARE_EVIDENCE_ENABLED.
export default function HealthcareVerificationPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Healthcare credentials"
        description="Submit evidence of your professional role and affiliation for review."
        actions={
          <ButtonLink href="/account" variant="outline">
            Back to profile
          </ButtonLink>
        }
      />
      <AuthGate
        message="Sign in to manage your healthcare credential submissions."
        returnTo="/account/healthcare-verification"
      >
        <HealthcareVerificationPanel />
      </AuthGate>
    </div>
  );
}
