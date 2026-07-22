import type { Metadata } from "next";
import AuthGate from "@/components/auth/auth-gate";
import AdminOperationsList from "@/components/admin/operations/admin-operations-list";
import PageHeader from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Job Execution Operations | The MediCN" };

export default function AdminJobsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Job executions" description="Read-only backend job execution state, classification, and failure categories." />
      <AuthGate message="Sign in with an administrator account to monitor job executions." returnTo="/admin/operations/jobs">
        <AdminOperationsList kind="jobs" />
      </AuthGate>
    </div>
  );
}
