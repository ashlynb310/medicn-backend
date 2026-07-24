import type { Metadata } from "next";
import AuthGate from "@/components/auth/auth-gate";
import AdminOperationsList from "@/components/admin/operations/admin-operations-list";
import PageHeader from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Host Transfer Operations | The MediCN" };

export default function AdminTransfersPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Host transfer operations"
        description="Read-only transfers to connected Stripe balances. These records do not represent bank payouts."
      />
      <AuthGate message="Sign in with an administrator account to monitor host transfers." returnTo="/admin/operations/transfers">
        <AdminOperationsList kind="transfers" />
      </AuthGate>
    </div>
  );
}
