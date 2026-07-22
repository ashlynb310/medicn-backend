import type { Metadata } from "next";
import Link from "next/link";
import AuthGate from "@/components/auth/auth-gate";
import AdminOperationDetail from "@/components/admin/operations/admin-operation-detail";
import PageHeader from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Operational Command Detail | The MediCN" };

export default async function AdminCommandDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={<Link href="/admin/operations/commands" className="hover:text-slate-900">Back to commands</Link>}
        title="Operational command detail"
        description="Read-only command status and backend-reported execution counts."
      />
      <AuthGate message="Sign in with an administrator account to inspect this command." returnTo={`/admin/operations/commands/${encodeURIComponent(id)}`}>
        <AdminOperationDetail kind="commands" resourceId={id} />
      </AuthGate>
    </div>
  );
}
