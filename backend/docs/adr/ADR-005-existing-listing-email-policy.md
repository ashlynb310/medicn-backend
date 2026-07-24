# ADR-005: Grandfather existing approved listings under the Host email gate

- Date: 2026-07-19
- Status: Accepted

## Context

Phase 5.6B requires verified Host email for new Admin approval while allowing an unverified Host to prepare draft/pending inventory. A policy is needed for listings approved before that gate or whose Host later becomes unverified.

## Source requirements

- [Week 2 API design](../../../MediCN-Weekly-Report/Week2/API-Design.md): accounts may precede email confirmation and publication may be email-gated.
- [AGENTS.md](../../AGENTS.md): approved listings are the public inventory boundary.
- [Backend gap audit](../backend-final-gap-audit.md): Phase 5.6B implemented approval-time gating and left ongoing enforcement as a product decision.

## Decision

- Unverified Hosts may create and edit draft or pending listings.
- Every new Admin approval requires the Host's current `emailVerifiedAt`.
- Existing approved listings are grandfathered and are not automatically hidden solely because the Host is currently unverified.
- A grandfathered listing must satisfy the current email gate whenever it goes through reapproval or a material status transition.
- Material transitions include `hidden`, `rejected`, or `archived` back to `approved`, and any address/ownership or moderation workflow that intentionally returns the listing to pending review. Ownership transfer is not otherwise approved by this ADR.
- Ordinary grandfathered display does not continuously poll email status. This avoids silently removing supply without an approved Host/account lifecycle workflow.
- Disabled-account listing visibility is not decided here; ADR-015 recommends a separate audited hide policy.

## Alternatives

1. **Immediately hide all approved listings for unverified Hosts:** rejected now because it changes existing supply and active-booking expectations without an account lifecycle workflow.
2. **Never reapply email verification to grandfathered listings:** rejected because it permanently bypasses the current publication trust gate.
3. **Block all draft/pending work until verification:** rejected because content preparation is reversible and Phase 5.6B intentionally gates publication, not authoring.

## Consequences

- Existing public inventory remains stable.
- Reapproval code must read the current Host record in the approval transaction; cached response data is not authoritative.
- Product copy must distinguish “save a listing” from “publish a listing.”
- A later account lifecycle phase must decide disabled-Host inventory and active-booking behavior.

## Backend invariants

- Only `approved` listings are public.
- Approval fails atomically with `EMAIL_NOT_VERIFIED`; no status change, approval audit, or approval notification is committed.
- Rejection remains possible for an unverified Host.
- Grandfathering never bypasses identity, location, moderation, or disabled-account rules.
- Reapproval always uses current Host email state, not approval-time history.

## API implications

- Existing listing create/update contracts remain available for draft/pending Hosts.
- Admin approval continues returning `EMAIL_NOT_VERIFIED` when the current gate fails.
- Any future restore/reapprove endpoint must apply the same gate.
- No automatic hide endpoint or background job is introduced by this ADR.

## Data/privacy implications

- No new personal data is required; the authoritative signal remains `User.emailVerifiedAt`.
- Public listing DTOs do not expose Host email or verification timestamps.
- Moderation audit may record that a gate failed only as a bounded code, not the Host email address.

## Tests required

- Unverified Host draft/pending create and edit succeed subject to existing role/ownership rules.
- New approval fails with no partial side effects; verified approval succeeds; rejection remains available.
- Grandfathered approved listing remains in public reads solely despite unverified email.
- Reapproval/material transition applies the current gate.
- Identity, location, and disabled-account gates remain independent and enforced.

## Unresolved questions

- Which approved-listing edits must force pending reapproval beyond address and ownership changes?
- What notification/support process applies when reapproval is blocked?
- Should a Host be able to regain Supabase email verification without manual review after a security event?

## Approval needed

No additional approval is needed for the grandfathering rule. The material-edit list should be confirmed by the product owner before a restore/reapproval API is implemented.

## Status

**Accepted.** Existing approved listings are grandfathered; current gates apply on new approval and future reapproval/material transition.
