import type { Metadata } from "next";
import AuthGate from "@/components/auth/auth-gate";
import InquiryThreadView from "@/components/messaging/inquiry-thread-view";
import { ButtonLink } from "@/components/ui/button-link";

export const metadata: Metadata = {
  title: "Conversation | The MediCN",
};

// Wired to GET /api/v1/inquiries/:id (thread + sequence-based catch-up) with
// Socket.IO /messaging notifications. Unauthorized or missing threads render an
// opaque not-found state.
export default async function InquiryThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <ButtonLink href="/messages" variant="outline" className="w-fit">
        All messages
      </ButtonLink>
      <AuthGate
        message="Sign in to read and reply to this conversation."
        returnTo={`/messages/${id}`}
      >
        <InquiryThreadView inquiryId={id} />
      </AuthGate>
    </div>
  );
}
