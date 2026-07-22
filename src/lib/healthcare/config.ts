// UI rollout guard for the healthcare-evidence workflow.
//
// This is ONLY a frontend rollout switch. Backend authorization remains
// authoritative in every case. Enabling it does not mean public-production
// healthcare evidence collection is approved — ADR-016's privacy, legal,
// disclosure, reviewer-process, incident, data-residency, appeal, backup, and
// audit-retention decisions remain open blockers.
//
// The literal `process.env.NEXT_PUBLIC_...` reference is required so Next.js
// inlines the value at build time.

export function isHealthcareEvidenceEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HEALTHCARE_EVIDENCE_ENABLED === "true";
}

/**
 * Pure form of the same check, so the rollout decision can be tested without a
 * build-time environment. Only the exact string "true" enables the UI.
 */
export function healthcareEvidenceEnabledFrom(
  value: string | undefined | null
): boolean {
  return value === "true";
}
