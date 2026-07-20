# ADR-012: Implement metadata-only healthcare credential review separately from Veriff identity

- Date: 2026-07-19
- Status: Accepted
- Superseded in part by: [ADR-016](ADR-016-temporary-healthcare-evidence.md), only for temporary private credential-file collection and deletion

## Context

Healthcare-specific trust is a core MediCN product goal, but government-ID verification does not verify clinical role, affiliation, student status, employment, or licensure. Phase 5.6B separated Veriff identity from healthcare state. The first credential workflow must minimize sensitive data while enabling an Admin decision.

## Source requirements

- [Product Planning](../../../_extracted_export/Product%20Planning%20e296cd360a844ace803814a81eb2a1ca.md) and [Founder Ideas](../../../_extracted_export/Founder%20Ideas%20c71bd3bbe0a44100910728a8c60991e1.md): healthcare-affiliation verification is a core trust feature.
- [AGENTS.md](../../AGENTS.md): identity and healthcare verification are separate; Veriff approval never implies credentials.
- [Week 2 API design](../../../MediCN-Weekly-Report/Week2/API-Design.md): current-user and Admin review endpoints, with Admin as final decision-maker.
- [Week 2 ERD](../../../MediCN-Weekly-Report/Week2/ERD-Database-Backend.md): healthcare status, submission, Admin reviewer/note, and optional AI recommendation fields.
- [Legal & Compliance](../../../_extracted_export/Legal%20%26%20Compliance%20cf2ddd28f07146dabd3e079984281942.md): healthcare-data disclosure, privacy, retention, and user-rights policy remain unapproved.
- [Backend gap audit](../backend-final-gap-audit.md): the workflow is missing and must remain independent of identity.

## Decision

Phase 5.7B may implement a metadata-only healthcare credential submission and Admin review workflow:

- User-submitted fields are claimed healthcare role, claimed affiliation name/type, and optional evidence category: `license`, `student`, `employment`, or `other`.
- Store submission timestamp, status, Admin decision timestamp, Admin reviewer ID, and a bounded private audit note.
- Do not accept or store raw credential documents, images, license/student/employee numbers, dates of birth, identity documents, selfies, or raw provider payloads.
- Any evidence review occurs out of band under an approved operational process; the database stores the evidence category and decision provenance, not the evidence itself.
- Admin is the only final decision-maker. Automated/AI review, if retained later, is advisory and cannot change final status.
- An approval means MediCN completed its defined manual metadata review; it must not be represented as a government, employer, school, licensing-board, or legal certification unless a later verified-source integration and disclosure are approved.
- `IdentityVerification` and `healthcareVerification` remain independent. Identity approval never creates, changes, or implies healthcare approval, role, or affiliation.

## Alternatives

1. **Upload credential files now:** rejected until collection purpose, access, private storage, retention, deletion, breach handling, and legal basis are approved.
2. **Infer healthcare status from Veriff:** prohibited because identity and professional credentials prove different facts.
3. **Treat self-declared profile role as approved:** rejected because a claim is not review.
4. **Require automated AI approval:** rejected; no raw evidence exists in v1 and Week 2 requires Admin final decision.

## Consequences

- Phase 5.7B is unblocked for a narrow metadata/Admin workflow.
- Existing healthcare schema may require a reviewed additive migration for explicit claim/evidence-category fields.
- Product language must distinguish `claimed`, `submitted`, `reviewed`, and `approved` without overstating what was verified.
- Raw document support remains Blocked and must be a separate ADR.

## Backend invariants

- Healthcare and identity writes never update one another.
- Only the authenticated subject submits their claim; only Admin decides it.
- Final approval/rejection records Admin ID, timestamp, prior state, and audit action.
- Resubmission/versioning preserves history; it does not overwrite prior decisions invisibly.
- Public/user DTOs expose only approved, product-necessary status/badge fields and never private Admin notes.
- Disabled accounts cannot submit or use normal protected reads.

## API implications

- Add a healthcare namespace distinct from identity, for example:
  - `POST /api/v1/healthcare-verifications`
  - `GET /api/v1/healthcare-verifications/me`
  - `GET /api/v1/admin/healthcare-verifications`
  - `PATCH /api/v1/admin/healthcare-verifications/:id`
- Do not reuse `/identity` or Veriff session routes.
- Validation allowlists roles/evidence categories and bounds affiliation/note lengths.
- Current-user DTO continues exposing `healthcareVerification.status`; deprecated `currentVerificationStatus` remains healthcare-only until frontend removal.

## Data/privacy implications

- Claims are healthcare-adjacent personal data even without documents; least-privilege Admin access, audit, encryption-in-transit/at-rest, and safe logs are required.
- Admin notes must prohibit diagnosis, treatment, unnecessary personal data, full credential numbers, and copied document content.
- Retention, deletion, correction, appeal, and legal-hold periods remain unresolved under ADR-015; public launch waits for policy.
- No raw files means no credential upload bucket or signed-download endpoint in v1.

## Tests required

- Identity approval/rejection/status events never mutate healthcare state and vice versa.
- Subject submission validation, role/ownership, duplicate/current-record policy, and disabled-account failure.
- Admin-only list/detail/decision, state transitions, final reviewer/timestamp, audit, and no partial side effects.
- Resubmission/history preservation and concurrent Admin decisions.
- Public/current-user/Admin DTO field allowlists and private-note/log redaction.
- No upload/document field or storage operation is accepted.
- Advisory AI output, if present, cannot set final status.

## Unresolved questions

- Exact out-of-band evidence-review procedure and who is authorized to perform it.
- Status expiry/renewal period by role/evidence category.
- Appeal/correction and affiliation-change process.
- Whether future authoritative school/employer/licensing-board verification is viable and lawful.
- Retention period and user-facing badge wording.

## Approval needed

No additional approval is needed to implement the metadata-only backend boundary. Product owner and privacy/legal approval are required for operational review procedure, public badge copy, retention, and any future document/provider collection before public launch.

## Status

**Accepted as the healthcare/identity separation and review baseline.**
[ADR-016](ADR-016-temporary-healthcare-evidence.md) supersedes only this ADR's
prohibition on temporary credential-file collection. The Admin decision,
minimization, truthful-copy, version-history, and Veriff-separation requirements
remain authoritative.
