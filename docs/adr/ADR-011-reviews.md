# ADR-011: Defer reviews while preserving a bounded future contract

- Date: 2026-07-19
- Status: Deferred

## Context

Week 2 defines listing reviews after completed bookings and the schema contains `Review`, but Product Planning places user reviews and ratings in the future roadmap. Completion is not yet implemented. A bounded future contract prevents unsafe assumptions without pulling reviews into the current milestone.

## Source requirements

- [Week 2 API design](../../../MediCN-Weekly-Report/Week2/API-Design.md): public listing-review reads and renter review creation after a completed booking.
- [Week 2 ERD](../../../MediCN-Weekly-Report/Week2/ERD-Database-Backend.md): completed-booking requirement, `1..5` rating, and one review per booking in the original renter-only model.
- [Product Planning](../../../_extracted_export/Product%20Planning%20e296cd360a844ace803814a81eb2a1ca.md): user reviews and Host/renter ratings are post-MVP.
- [Backend gap audit](../backend-final-gap-audit.md): source priority conflicts and review depends on completion.

## Decision

Reviews are Deferred from the current backend milestone. If the product owner reaffirms Phase 5.8C, the initial boundary is:

- Only a participant in a `completed` booking may author a review tied to that booking.
- The first listing/Host review direction follows Week 2: the booking renter reviews the listing/Host. Reciprocal Host-to-renter reviews require a separate target model and explicit approval.
- One review per reviewer per booking per target; database uniqueness, not browser state, enforces it.
- Rating is an integer from 1 through 5.
- Comment is optional, trimmed, and limited to 2,000 Unicode code points; an empty trimmed comment is stored as null.
- Reviews are attributable to the reviewer and are not anonymous.
- Review content must not disclose healthcare credential evidence, identity-provider results, exact address, booking access instructions, phone/email, or other sensitive personal data.
- Admin moderation may hide a review with actor, reason, timestamp, and append-only audit. Hiding does not delete it or change the underlying booking.
- Listing/Host aggregate rating is derived server-side from visible reviews and never accepted from the browser.

## Alternatives

1. **Implement now because the table exists:** rejected; schema presence is not approved scope and completion is missing.
2. **Anonymous reviews:** rejected because completed-booking accountability and moderation require authorship.
3. **One review total per booking forever:** not adopted as the general model because it prevents reciprocal targets; the initial renter-only implementation may retain a simpler uniqueness constraint until reciprocal reviews are approved.
4. **Hard-delete moderated reviews:** rejected because it weakens auditability.

## Consequences

- Phase 5.8C remains blocked until owner reaffirmation and ADR-010 completion approval/implementation.
- Future reciprocal reviews require explicit target semantics and likely schema changes.
- Moderation and privacy validation are part of review implementation, not optional follow-up.

## Backend invariants

- Author is an enabled booking participant and booking is authoritatively `completed`.
- Review listing/target is derived from the booking, not trusted from the browser.
- Uniqueness is enforced transactionally/database-side.
- Aggregates include only visible eligible reviews and are recalculated/queried server-side.
- Moderation never rewrites rating/content without a separately approved redaction policy.

## API implications

- Retain proposed `GET /api/v1/listings/:id/reviews` and `POST /api/v1/listings/:id/reviews` only after reactivation.
- Creation accepts `bookingId`, `rating`, and optional `comment`; listing/reviewer/target fields are server-derived.
- Public DTOs expose bounded reviewer display identity, not email, phone, roles/credentials, booking dates, or exact location.
- Admin hide/restore requires an audited moderation endpoint and stable reason codes.

## Data/privacy implications

- Review text is public user-generated content and needs notice, reporting, moderation, retention, and deletion policy.
- Healthcare/identity disclosure is prohibited even if the reviewer learned it through the transaction.
- Deletion requests must reconcile public removal with audit/legal-hold requirements under ADR-015.

## Tests required

- Completed participant success; nonparticipant, pre-completion, cancelled/refunded/disputed, disabled actor, and duplicate failures.
- Rating boundaries, 2,000-code-point limit, trimming, and sensitive-content/contact-information policy.
- Concurrent duplicate creation and database uniqueness.
- Public DTO privacy and visible-only aggregate calculation.
- Admin hide/restore authorization, audit, aggregate updates, and idempotency.
- No browser-supplied aggregate, reviewer, listing target, or eligibility bypass.

## Unresolved questions

- Whether Phase 5.8C is reaffirmed for the MVP.
- Whether reciprocal Host-to-renter reviews are ever enabled and whether they are double-blind until both submit.
- Reporting categories, appeal/restoration policy, and moderator roles.
- Final public display-name and retention/deletion rules.

## Approval needed

Product owner approval is required to move this ADR from Deferred, choose renter-only versus reciprocal targets, and approve moderation/display policy.

## Status

**Deferred.** Product Planning places reviews in the future roadmap; no review runtime work is unblocked.
