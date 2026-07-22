import type { Metadata } from "next";
import PageHeader from "@/components/layout/page-header";
import AuthGate from "@/components/auth/auth-gate";
import AdminHealthcareDetail from "@/components/admin/admin-healthcare-detail";
import { ButtonLink } from "@/components/ui/button-link";

export const metadata: Metadata = {
  title: "Healthcare Submission | The MediCN",
};

// Admin review detail (GET /admin/healthcare-verifications/:id). Evidence is
// revealed only through an explicit, audited, short-lived signed URL.
export default async function AdminHealthcareDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Healthcare submission"
        description="Review the claim and sanitized evidence, then record a decision."
        actions={
          <ButtonLink href="/admin/healthcare-verifications" variant="outline">
            Review queue
          </ButtonLink>
        }
      />
      <AuthGate
        message="Sign in with an administrator account to review this submission."
        returnTo={`/admin/healthcare-verifications/${id}`}
      >
        <AdminHealthcareDetail id={id} />
      </AuthGate>
    </div>
  );
}
