# Phase 5.7B healthcare evidence backend

Phase 5.7B implements ADR-016's temporary, private healthcare-affiliation
evidence workflow. It is backend-only. Identity verification remains a separate
prerequisite and is never inferred from, or mutated by, healthcare review.

This implementation does not authorize public-production collection. The
privacy, legal, disclosure, reviewer-process, incident, data-residency, appeal,
backup, and audit-retention decisions in ADR-016 remain blockers.

## Data and lifecycle

Migration `20260728000000_add_healthcare_evidence` adds versioned claim history,
evidence records, decision provenance, cleanup timestamps, operational indexes,
and a PostgreSQL partial unique index that permits only one active submission
per user. Migration `20260728010000_allow_healthcare_media_purpose` hardens the
existing `MediaAsset` database constraint so the new private purpose is allowed
only without listing/profile ownership.

The submission lifecycle is:

`created -> uploading -> processing -> pending_review -> deletion_pending -> evidence_deleted`

Processing can end in `processing_failed`; an Admin decision records `approved`
or `rejected` as the retained decision while the evidence lifecycle moves to
`deletion_pending`. Withdrawal is allowed only before a decision and also
durably requests deletion. Exhausted provider cleanup attempts surface as
`deletion_failed` for operations recovery. Historical submissions are retained
as versioned claim/decision metadata after image deletion.

Database advisory locks plus the partial unique index enforce one active
submission under concurrent creation. Admin decisions row-lock the submission,
so only one concurrent decision can commit. The decision, compatibility cache,
bounded audit row, and opaque deletion Outbox event commit atomically.

## Authentication and authorization

All endpoints require a Supabase Bearer token and use the shared disabled-user
check. Subject creation additionally requires an approved
`IdentityVerification`; identity records and events never create or change a
healthcare record. Subject resources use opaque not-found behavior for a
different owner. Admin endpoints require the `admin` role before querying or
signing evidence.

Subject endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/healthcare-verifications` | Create the next versioned claim |
| `POST` | `/api/v1/healthcare-verifications/:id/evidence/upload-intents` | Create one private upload intent |
| `POST` | `/api/v1/healthcare-verifications/:id/evidence/:evidenceId/complete` | Confirm upload and enqueue processing |
| `POST` | `/api/v1/healthcare-verifications/:id/submit` | Submit 1-3 ready sanitized images |
| `GET` | `/api/v1/healthcare-verifications/me` | Read redacted current state and history |
| `POST` | `/api/v1/healthcare-verifications/:id/withdraw` | Withdraw before decision and request deletion |

Admin endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/healthcare-verifications` | Bounded/filterable review queue; defaults to pending review |
| `GET` | `/api/v1/admin/healthcare-verifications/:id` | Claim, readiness, and decision detail |
| `POST` | `/api/v1/admin/healthcare-verifications/:id/evidence/:evidenceId/view-url` | Audit and return a private view URL valid for at most 60 seconds |
| `PATCH` | `/api/v1/admin/healthcare-verifications/:id` | Approve or reject exactly one pending submission |

Claims accept only the defined healthcare role, affiliation type, evidence
category, and a trimmed affiliation name of 1-200 characters. A decision accepts
only `approved` or `rejected`, an allowlisted reason code, and an optional
trimmed Admin note of at most 1,000 characters.

## Private media boundary

Each submission accepts at most three JPEG, PNG, or WebP images, each at most
10 MiB. PDF and all other formats are rejected at the DTO boundary. The media
processor verifies magic bytes, decodes with byte/dimension/pixel limits,
normalizes orientation, removes EXIF/GPS/ICC metadata, and creates exactly one
private WebP `healthcare_review` derivative.

Both quarantine and derivative objects use the dedicated private
`healthcare-credentials` bucket. Immutable object paths are rooted at:

`healthcare-evidence/<internal-user-id>/<verification-id>/<evidence-id>/...`

The original is deleted and checked absent immediately after the derivative is
ready. Submission is blocked until the derivative is ready and the original is
confirmed absent. No healthcare asset receives a public URL, and generic media
status/deletion endpoints return opaque not-found for this purpose.

Admin viewing signs only the sanitized derivative, only while a submission is
pending review, and for no more than 60 seconds. The audit and bounded access
counter commit before URL generation. The URL and storage path are not stored
in audit metadata, Outbox/BullMQ payloads, or logs.

## Durable deletion and operations

Approval, rejection, and withdrawal write an Outbox event in the same database
transaction as their state change. Its payload contains only the opaque
healthcare verification ID. The media worker resolves private paths from
PostgreSQL, requests deletion, and calls the storage provider's existence check
for every remaining original and derivative. Only confirmed absence permits
`evidence_deleted` and deleted media timestamps.

Deletion is idempotent. Retryable failure remains `deletion_pending`; exhausted
attempts become `deletion_failed` and appear in
`GET /api/v1/admin/operations/status`. The media recovery command revisits both
states. See [the worker operations runbook](worker-operations-runbook.md).

## Privacy limits

Subject responses expose claims, lifecycle, counts, and coarse evidence state,
but never reviewer identity/note, storage coordinates, or URLs. Admin review
responses are explicit allowlists and do not contain storage paths. Redis,
Outbox, audit metadata, and worker logs must contain no image bytes, signed URL,
credential content, OCR text, message body, identity document data, or other
sensitive evidence. No OCR, PDF processing, external credential-provider call,
or live provider call is implemented.
