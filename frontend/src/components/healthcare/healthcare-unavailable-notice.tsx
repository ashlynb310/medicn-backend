import { ButtonLink } from "@/components/ui/button-link";

/**
 * Honest unavailable state for the healthcare rollout guard. Rendered instead of
 * any healthcare surface while NEXT_PUBLIC_HEALTHCARE_EVIDENCE_ENABLED is off —
 * no healthcare API request is made in that state. Backend authorization remains
 * authoritative regardless of this flag.
 */
export default function HealthcareUnavailableNotice({
  context,
}: {
  context: "subject" | "review";
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-base font-semibold text-slate-900">
          {context === "review"
            ? "Healthcare credential review isn't available yet"
            : "Healthcare credential verification isn't available yet"}
        </h2>
        <p className="text-sm text-slate-600">
          {context === "review"
            ? "This review workflow is not enabled on MediCN. No credential submissions or evidence are loaded."
            : "This workflow is not enabled on MediCN. Nothing is uploaded or submitted, and no credential evidence is collected."}
        </p>
      </div>
      <ButtonLink
        href={context === "review" ? "/admin/listings" : "/account"}
        variant="outline"
        className="w-fit"
      >
        {context === "review" ? "Listing moderation" : "Back to profile"}
      </ButtonLink>
    </div>
  );
}
