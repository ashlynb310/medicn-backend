import type { Metadata } from "next";
import Link from "next/link";
import AuthGate from "@/components/auth/auth-gate";
import AdminOperationDetail from "@/components/admin/operations/admin-operation-detail";
import PageHeader from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Host Transfer Detail | The MediCN" };

export default async function AdminTransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={<Link href="/admin/operations/transfers" className="hover:text-slate-900">Back to host transfers</Link>}
        title="Host transfer detail"
        description="A transfer to the connected Stripe balance, not a bank payout."
      />
      <AuthGate message="Sign in with an administrator account to inspect this transfer." returnTo={`/admin/operations/transfers/${encodeURIComponent(id)}`}>
        <AdminOperationDetail kind="transfers" resourceId={id} />
      </AuthGate>
    </div>
  );
}
