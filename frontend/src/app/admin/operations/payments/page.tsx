import type { Metadata } from "next";
import AuthGate from "@/components/auth/auth-gate";
import AdminOperationsList from "@/components/admin/operations/admin-operations-list";
import PageHeader from "@/components/layout/page-header";

export const metadata: Metadata = {
  title: "Payment Operations | The MediCN",
  description: "Monitor payment attempts reported by the backend.",
};

export default function AdminPaymentsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payment operations"
        description="Read-only payment attempt status and backend integer-cent amounts."
      />
      <AuthGate message="Sign in with an administrator account to monitor payments." returnTo="/admin/operations/payments">
        <AdminOperationsList kind="payments" />
      </AuthGate>
    </div>
  );
}
