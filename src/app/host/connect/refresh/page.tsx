import type { Metadata } from "next";
import PageHeader from "@/components/layout/page-header";
import ConnectReturnPanel from "@/components/host/connect-return-panel";

export const metadata: Metadata = {
  title: "Payout Setup | The MediCN",
};

// Stripe's configured refresh_url, used when a hosted session expires or is
// interrupted. The panel reads GET /connect/account for the authoritative state.
export default function HostConnectRefreshPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Payout setup"
        description="Your Stripe session needs restarting."
      />
      <ConnectReturnPanel mode="refresh" />
    </div>
  );
}
