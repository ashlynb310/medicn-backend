import type { Metadata } from "next";
import Link from "next/link";
import AuthGate from "@/components/auth/auth-gate";
import AdminOperationDetail from "@/components/admin/operations/admin-operation-detail";
import PageHeader from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Job Execution Detail | The MediCN" };

export default async function AdminJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={<Link href="/admin/operations/jobs" className="hover:text-slate-900">Back to job executions</Link>}
        title="Job execution detail"
        description="Exact read-only execution state returned by the backend."
      />
      <AuthGate message="Sign in with an administrator account to inspect this job execution." returnTo={`/admin/operations/jobs/${encodeURIComponent(id)}`}>
        <AdminOperationDetail kind="jobs" resourceId={id} />
      </AuthGate>
    </div>
  );
}
