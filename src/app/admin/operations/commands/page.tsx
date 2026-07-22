import type { Metadata } from "next";
import AuthGate from "@/components/auth/auth-gate";
import AdminOperationsList from "@/components/admin/operations/admin-operations-list";
import PageHeader from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Operational Commands | The MediCN" };

export default function AdminCommandsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Operational commands" description="Read-only history of operational commands issued by authorized backend workflows." />
      <AuthGate message="Sign in with an administrator account to monitor command history." returnTo="/admin/operations/commands">
        <AdminOperationsList kind="commands" />
      </AuthGate>
    </div>
  );
}
