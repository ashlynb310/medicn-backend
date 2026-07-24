# ADR-016: Temporarily retain private healthcare evidence for Admin review

- Date: 2026-07-19
- Status: Accepted
- Supersedes in part: [ADR-012](ADR-012-healthcare-credential-review.md), only its prohibition on temporary credential-file collection

## Context

ADR-012 established that Veriff identity and healthcare credential review are
separate and initially allowed only a metadata review. The product owner has now
approved a bounded evidence workflow so an Admin can review an actual credential
image. The evidence is needed only during review and must not become a permanent
profile document, public asset, or substitute for an authoritative registry.

This decision preserves ADR-012's identity separation, Admin decision, data
minimization, truthful product language, and history requirements. It changes
only the previous decision not to collect credential files at all.

## Source requirements

- [ADR-012](ADR-012-healthcare-credential-review.md): healthcare review remains separate from Veriff and Admin-decided.
- [AGENTS.md](../../AGENTS.md): sensitive evidence requires private storage, least privilege, audit, processing, and deletion.
- [Media upload security](../../AGENTS.md#media-upload-security): an upload is quarantined until server-side inspection and sanitization complete.
- [Account lifecycle ADR](ADR-015-account-lifecycle.md): broader retention, correction, legal hold, and account erasure remain unresolved.
- Product-owner decision in this project thread on 2026-07-19: permit temporary Admin-reviewed healthcare evidence and delete it after review.

## Decision

Phase 5.7B may implement temporary private healthcare credential evidence with
the following boundary:

- Require an approved `IdentityVerification` before evidence submission. Veriff
  still proves identity only and never sets healthcare status.
- Use a dedicated private Supabase Storage bucket named
  `healthcare-credentials`. Never use listing, avatar, or another public bucket.
- Accept at most three JPEG, PNG, or WebP images per submission, with a maximum
  size of 10 MB each. PDF and other active document formats are excluded from v1.
- The backend creates immutable, user/submission-bound object paths and upload
  intents. The browser cannot select a trusted owner, submission, or path.
- New objects are quarantined. Actual magic bytes, decode limits, dimensions,
  and file size are checked server-side; accepted images are re-encoded and
  stripped of EXIF/GPS and unnecessary metadata.
- Delete the original object after a sanitized private derivative is ready. The
  sanitized derivative is the only evidence presented to an Admin.
- Generate Admin view URLs server-side only, after authorization, with a maximum
  lifetime of 60 seconds. Do not persist, return in list DTOs, or log signed URLs.
- Record a bounded audit event whenever an Admin requests evidence access.
- Admin is the only final decision-maker. Approval or rejection records the
  reviewer, decision time, prior and new status, reason, and bounded private note
  atomically.
- After either final decision, or a user withdrawal before decision, enqueue
  durable deletion of every remaining original and derivative object.
- A final decision may report `deletion_pending`. Evidence becomes
  `evidence_deleted` only after the Storage API confirms removal. Retry failures
  durably; a terminal failure becomes `deletion_failed` and raises an operations
  alert instead of being hidden.
- Keep only the minimum claim, decision, audit, and deletion metadata after
  evidence removal. Do not retain thumbnails, OCR text, extracted document
  fields, signed URLs, or credential images.
- Public wording may say `Reviewed by MediCN` or an equivalent bounded phrase.
  It must not claim government, employer, school, licensing-board, or Veriff
  certification.

## Lifecycle

The evidence workflow is:

```text
created -> uploading -> processing -> pending_review
pending_review -> approved|rejected -> deletion_pending -> evidence_deleted
created|uploading|processing|pending_review -> withdrawn -> deletion_pending
uploading|processing -> processing_failed
deletion_pending -> deletion_failed
```

`processing_failed` evidence is never reviewable and is queued for cleanup.
`deletion_failed` is an operational incident state with an explicit retry path.
No transition may silently discard decision or deletion history.

## Alternatives

1. **Metadata-only review:** retained as a lower-risk fallback, but rejected as
   the only workflow because an Admin cannot substantively inspect evidence.
2. **Use Veriff for healthcare credentials:** rejected because the configured
   identity workflow does not prove clinical role, student/employment status, or
   professional licensure.
3. **Retain evidence indefinitely:** rejected because it increases privacy and
   breach impact without a current product need.
4. **Public or stable evidence URLs:** prohibited because possession of such a
   URL would bypass the intended short, audited authorization boundary.
5. **PDF support in v1:** deferred until active-content scanning and safe preview
   isolation are designed and tested.

## Consequences

- Phase 5.7B is implementation-unblocked for this bounded development and test
  workflow.
- The existing media pipeline may be extended, but healthcare evidence must keep
  separate purposes, paths, private delivery, DTOs, and cleanup policy.
- Storage deletion is asynchronous and operationally observable; the Admin
  decision is not rolled back by a temporary Storage outage.
- Users must upload evidence again for a later appeal or resubmission after it is
  deleted.
- Public production launch remains blocked on privacy/legal review, final user
  disclosure and consent, reviewer procedure, appeal/correction rules, data
  residency, incident handling, and authoritative-source policy.

## Backend invariants

- Healthcare and identity writes never update one another.
- Only the authenticated subject may create an evidence submission, and only
  after approved identity. Only Admin may request a view URL or decide it.
- Storage paths, signed URLs, document images, extracted text, and private Admin
  notes never enter public/current-user DTOs.
- File content, signed URLs, credential numbers, dates of birth, home addresses,
  and other extracted sensitive fields never enter logs, metrics, email,
  Outbox/BullMQ payloads, or `AdminAction` metadata.
- Outbox deletion payloads contain opaque asset/submission identifiers only. A
  worker resolves the authorized storage path server-side.
- Storage deletion uses the Storage API, is idempotent, is retried, and is not
  represented as complete before provider confirmation.
- A database row or signed-upload response alone never makes evidence
  reviewable; server-side processing must mark the sanitized derivative ready.

## API implications

Phase 5.7B may add healthcare-specific endpoints for submission, upload intents,
completion/status, withdrawal, Admin queues/detail, short-lived Admin evidence
viewing, and Admin decisions. These routes remain separate from `/identity` and
must use the shared disabled-account and opaque-resource boundaries.

The exact DTOs must allowlist only healthcare claims, evidence category, upload
metadata, status, and bounded decision fields. No request may set `userId`,
reviewer, final status, storage path, media readiness, or deletion status.

## Data and privacy implications

Credential images and claims are sensitive personal evidence. Production use
requires a clear collection purpose and notice, least-privilege reviewer access,
encryption in transit and at rest, audited access, incident handling, and an
approved deletion/backup statement. Immediate application-level deletion does
not by itself settle legal holds, infrastructure backups, support exports, or
data-subject rights under ADR-015.

## Tests required

- Approved-identity, ownership, disabled-account, role, and Admin authorization.
- Controlled object paths, upload limits, MIME spoofing, malformed images,
  oversized/pixel-bomb images, EXIF/GPS removal, and sanitized derivatives.
- Private-bucket behavior and absence of public/stable evidence URLs.
- Admin view authorization, 60-second maximum, access audit, opaque unrelated
  IDs, and no signed URL persistence/logging.
- Concurrent submissions and Admin decisions, immutable decision provenance,
  and continued identity/healthcare separation.
- Decision/withdrawal to durable deletion, original cleanup after processing,
  retry/idempotency, provider-confirmed completion, and terminal failure alerts.
- DTO, audit, log, metric, email, Outbox, BullMQ, and status-endpoint redaction.
- No PDF, OCR, document number, date of birth, home-address, identity-document,
  or selfie input in v1.

## Unresolved questions

- Final privacy/legal basis, user consent and disclosure text for public launch.
- Which Admin roles may review evidence and the operational reviewer procedure.
- Appeal/correction behavior after evidence deletion.
- Audit-metadata retention, legal holds, backups, exports, and account deletion.
- Badge copy, expiration/renewal, and authoritative school, employer, or
  licensing-board integrations.

## Approval needed

The product owner has approved implementation of the bounded workflow in this
ADR. Privacy/legal, security operations, reviewer-process, disclosure, and
production-environment approval are still required before collecting real user
credential evidence in public production.

## Status

**Accepted for implementation and controlled testing.** This is not approval to
collect real credential evidence in public production.
