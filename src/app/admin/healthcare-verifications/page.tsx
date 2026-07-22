import type { Metadata } from "next";
import PageHeader from "@/components/layout/page-header";
import AuthGate from "@/components/auth/auth-gate";
import AdminHealthcareQueue from "@/components/admin/admin-healthcare-queue";

export const metadata: Metadata = {
  title: "Healthcare Review | The MediCN",
  description: "Review submitted healthcare credential evidence.",
};

// Admin review queue (GET /admin/healthcare-verifications). The backend enforces
// the `admin` role and returns FORBIDDEN otherwise; this page never grants roles.
// Separate from Veriff identity verification.
export default function AdminHealthcareQueuePage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Healthcare review"
        description="Review healthcare credential submissions and record decisions."
      />
      <AuthGate
        message="Sign in with an administrator account to review healthcare credentials."
        returnTo="/admin/healthcare-verifications"
      >
        <AdminHealthcareQueue />
      </AuthGate>
    </div>
  );
}
