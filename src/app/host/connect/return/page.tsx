import type { Metadata } from "next";
import PageHeader from "@/components/layout/page-header";
import ConnectReturnPanel from "@/components/host/connect-return-panel";

export const metadata: Metadata = {
  title: "Payout Setup | The MediCN",
};

// Stripe's configured return_url. Arriving here is NOT proof that onboarding
// succeeded; the panel reads GET /connect/account for the authoritative state.
export default function HostConnectReturnPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Payout setup"
        description="Your authoritative payout status from MediCN."
      />
      <ConnectReturnPanel mode="return" />
    </div>
  );
}
