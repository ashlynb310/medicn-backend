import type { Metadata } from "next";
import PageHeader from "@/components/layout/page-header";
import AuthGate from "@/components/auth/auth-gate";
import MessagesInbox from "@/components/messaging/messages-inbox";

export const metadata: Metadata = {
  title: "Messages | The MediCN",
  description: "Your conversations with hosts and renters on The MediCN.",
};

// Wired to GET /api/v1/inquiries — the participant-scoped inbox with open,
// closed, and archived views plus backend pagination.
export default function MessagesPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Messages"
        description="Your conversations about listings."
      />
      <AuthGate
        message="Sign in to read and reply to your MediCN conversations."
        returnTo="/messages"
      >
        <MessagesInbox />
      </AuthGate>
    </div>
  );
}
