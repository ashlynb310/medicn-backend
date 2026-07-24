import type { HealthcareSubmission } from "@/lib/api/healthcare";
import {
  affiliationNameLabel,
  affiliationTypeLabel,
  describeSubmissionStatus,
  evidenceCategoryLabel,
  healthcareRoleLabel,
} from "@/lib/healthcare/submission";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Versioned history using REDACTED metadata only: claim fields, lifecycle
 * status, decision, dates, and counts. The subject projection contains no
 * reviewer identity, Admin note, or reason code — so none is shown, and no
 * rejection reason is ever invented.
 */
export default function HealthcareHistoryList({
  submissions,
}: {
  submissions: HealthcareSubmission[];
}) {
  if (submissions.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-slate-900">
        Submission history
      </h2>
      <ul className="flex flex-col gap-3">
        {submissions.map((submission) => {
          const presentation = describeSubmissionStatus(submission.status);
          const created = formatDate(submission.createdAt);
          const submitted = formatDate(submission.submittedAt);
          const decided = formatDate(submission.decidedAt);
          const withdrawn = formatDate(submission.withdrawnAt);
          return (
            <li
              key={submission.id}
              className="flex flex-col gap-1.5 rounded-xl border border-slate-200 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">
                  Version {submission.version} ·{" "}
                  {healthcareRoleLabel(submission.claimedRole)}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  {presentation.label}
                </span>
              </div>
              <p className="text-sm text-slate-700">
                {affiliationNameLabel(submission.claimedAffiliationName)}
                {" · "}
                {affiliationTypeLabel(submission.claimedAffiliationType)}
              </p>
              <p className="text-xs text-slate-500">
                {evidenceCategoryLabel(submission.evidenceCategory)}
                {" · "}
                {submission.evidenceCount}{" "}
                {submission.evidenceCount === 1 ? "image" : "images"}
              </p>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {created && (
                  <div className="flex gap-1">
                    <dt>Created</dt>
                    <dd className="font-medium text-slate-700">{created}</dd>
                  </div>
                )}
                {submitted && (
                  <div className="flex gap-1">
                    <dt>Submitted</dt>
                    <dd className="font-medium text-slate-700">{submitted}</dd>
                  </div>
                )}
                {decided && (
                  <div className="flex gap-1">
                    <dt>Decision</dt>
                    <dd className="font-medium text-slate-700">{decided}</dd>
                  </div>
                )}
                {withdrawn && (
                  <div className="flex gap-1">
                    <dt>Withdrawn</dt>
                    <dd className="font-medium text-slate-700">{withdrawn}</dd>
                  </div>
                )}
              </dl>
              {submission.decision && (
                <p className="text-sm font-medium text-slate-800">
                  Decision:{" "}
                  {submission.decision === "approved" ? "Approved" : "Rejected"}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
