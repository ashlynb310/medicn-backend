import type { Metadata } from "next";
import Link from "next/link";
import AuthGate from "@/components/auth/auth-gate";
import AdminOperationDetail from "@/components/admin/operations/admin-operation-detail";
import PageHeader from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Payment Detail | The MediCN" };

export default async function AdminPaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={<Link href="/admin/operations/payments" className="hover:text-slate-900">Back to payments</Link>}
        title="Payment detail"
        description="Exact read-only payment fields and operational provider references returned by the backend."
      />
      <AuthGate message="Sign in with an administrator account to inspect this payment." returnTo={`/admin/operations/payments/${encodeURIComponent(id)}`}>
        <AdminOperationDetail kind="payments" resourceId={id} />
      </AuthGate>
    </div>
  );
}
