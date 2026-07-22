import type { Metadata } from "next";
import AuthGate from "@/components/auth/auth-gate";
import AdminOperationsStatusPanel from "@/components/admin/operations/admin-operations-status";
import PageHeader from "@/components/layout/page-header";

export const metadata: Metadata = {
  title: "Operations Status | The MediCN",
  description: "Monitor backend-reported operational status.",
};

export default function AdminOperationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Operations status"
        description="Backend-reported outbox, failure, and worker heartbeat status. This view does not inspect infrastructure directly."
      />
      <AuthGate
        message="Sign in with an administrator account to monitor operations."
        returnTo="/admin/operations"
      >
        <AdminOperationsStatusPanel />
      </AuthGate>
    </div>
  );
}
