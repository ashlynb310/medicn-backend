import type { Metadata } from "next";
import PageContainer from "@/components/layout/page-container";
import PageHeader from "@/components/layout/page-header";
import AuthGate from "@/components/auth/auth-gate";
import AdminListingsModeration from "@/components/admin/admin-listings-moderation";

export const metadata: Metadata = {
  title: "Listing Moderation | The MediCN",
  description: "Review and moderate host listings.",
};

// Admin-only. AuthGate handles the logged-out case (sign-in prompt); the
// moderation component enforces the admin-role case (forbidden block) and is
// backed by the backend, which authorizes every request. There is intentionally
// no UI here to grant the admin role — that is a CLI-only bootstrap.
export default function AdminListingsPage() {
  return (
    <PageContainer width="wide">
      <PageHeader
        title="Listing moderation"
        description="Review pending listings and approve or reject them. Decisions are recorded in the admin audit log."
      />
      <AuthGate
        message="Sign in with an administrator account to moderate listings."
        returnTo="/admin/listings"
      >
        <AdminListingsModeration />
      </AuthGate>
    </PageContainer>
  );
}
