# ADR-015: Define the future account lifecycle and keep destructive actions blocked

- Date: 2026-07-19
- Status: Blocked

## Context

Phase 5.6B enforces `User.disabledAt` at the shared authenticated-user boundary, but there is no approved Admin disable/re-enable API, listing-visibility policy, active-booking disposition, deletion process, retention schedule, legal-hold policy, or Supabase deletion coordination.

## Source requirements

- [AGENTS.md](../../AGENTS.md): Supabase owns authentication; internal authorization and durable marketplace/financial state remain backend responsibilities.
- [Week 2 ERD](../../../MediCN-Weekly-Report/Week2/ERD-Database-Backend.md): `disabledAt` is a soft-disable field and `AdminAction.disable_user` is an audit action.
- [Legal & Compliance](../../../_extracted_export/Legal%20%26%20Compliance%20cf2ddd28f07146dabd3e079984281942.md): termination, privacy rights, deletion, retention, and dispute policy are drafts requiring qualified review.
- [Backend gap audit](../backend-final-gap-audit.md): disable enforcement exists; lifecycle mutation/deletion and related policies do not.
- [ADR-005](ADR-005-existing-listing-email-policy.md), [ADR-006](ADR-006-booking-cancellation-policy.md), [ADR-008](ADR-008-listing-archive-policy.md), and [ADR-013](ADR-013-stripe-marketplace-boundary.md): listing, booking, and financial obligations cannot be collapsed into account state.

## Decision

The following is the proposed future lifecycle boundary; implementation remains Blocked until approvals below:

- **Disable:** an authorized Admin records target user, actor, allowlisted reason, timestamp, and private audit note. The transaction sets `disabledAt`; all normal protected requests continue failing with `ACCOUNT_DISABLED` under Phase 5.6B. Supabase session deletion is not required for backend denial.
- **Listing visibility:** when a Host is disabled, a later account-lifecycle workflow should hide their approved listings from new public discovery and new inquiries/bookings, with an audited system/Admin hide. This is a hide, not archive/delete, and does not itself cancel bookings. This recommendation requires owner approval before implementation.
- **Active bookings:** disable does not silently reject/cancel/refund/complete bookings. Each future active booking requires an Admin/support disposition under ADR-006. Until disposition, authoritative booking/payment state controls renter records and check-in access. New bookings and normal actions by the disabled user are blocked.
- **Payments/transfers:** trusted internal webhook/worker/reconciliation processes may continue obligations already created, including refunds, dispute handling, transfer/reversal, and financial record retention. A risk/legal hold may block transfer release only through an explicit audited financial policy; request authentication is not used to impersonate the disabled user.
- **Re-enable:** requires authorized Admin actor/reason/audit and clears `disabledAt`. Listings hidden due to disable are not automatically republished; they return through current approval/reapproval gates, including email, identity, location, and moderation.
- **Deletion request:** is a privacy workflow, not immediate row deletion. It records request/verification/scope/status, applies approved retention and legal holds, removes or anonymizes eligible data, and preserves required financial, dispute, security, and audit records.
- **Supabase coordination:** delete/revoke the Supabase account only after identity confirmation and the internal deletion plan reaches the approved stage. Internal and Supabase operations need resumable idempotent reconciliation; neither side is assumed atomic with the other.

## Alternatives

1. **Delete the internal/Supabase user immediately:** rejected because it can break audit, bookings, payments, disputes, transfers, and legal retention.
2. **Leave disabled Host listings public indefinitely:** not recommended because it allows new demand against a Host who cannot respond.
3. **Automatically cancel every active booking on disable:** rejected without cancellation/refund/safety policy; disable reasons have different risk implications.
4. **Automatically restore listings on re-enable:** rejected because trust/location/content may need reapproval.

## Consequences

- Account disable remains enforceable but Admin mutation, listing hide, re-enable, and deletion work stay blocked.
- Internal worker/user lookups must be explicitly named and authorized by domain purpose, not routed through request authentication.
- A support/operations queue and audit detail are needed before disabling users with active obligations.
- Legal retention may require anonymization/pseudonymization rather than deletion of some relations.

## Backend invariants

- `disabledAt != null` always blocks normal authenticated application actions, including Admin actions.
- Disable/re-enable/delete operations are idempotent, authorized, reasoned, and append-only audited.
- Disable never erases or fabricates booking/payment/transfer/identity/credential history.
- New public demand is prevented after approved Host-disable hide, while participant historical records remain authorized.
- Internal financial/provider processing uses service boundaries and cannot reactivate/bypass the account for user actions.
- Re-enable does not republish or restore privileged roles/actions automatically.

## API implications

Future, separately approved Admin/privacy routes may include:

- `POST /api/v1/admin/users/:id/disable`
- `POST /api/v1/admin/users/:id/re-enable`
- `GET /api/v1/admin/users/:id/lifecycle-impact`
- authenticated privacy request create/status endpoints

Admin responses must expose lifecycle impact without unnecessary message, credential, exact-location, or provider data. Supabase deletion remains an internal orchestrated step, not a browser-controlled flag.

## Data/privacy implications

- Disable reason/private notes can be sensitive and are Admin-only.
- Data inventory must classify account/profile, listing/media, message, identity, healthcare claim, booking/location, payment/transfer, webhook, email, and audit retention separately.
- Identity and credential provider data may have separate processor deletion APIs/contract terms.
- Legal hold, fraud/dispute, tax/accounting, backup, and derived/public-content handling need documented periods and user disclosures.
- This ADR is not legal advice and does not establish a lawful retention basis.

## Tests required

- Phase 5.6B disabled boundary across representative protected/Admin flows remains.
- Disable/re-enable authorization, idempotency, audit, race behavior, and no self-assigned Admin recovery.
- Host listing hide blocks public/new demand without implicit booking cancellation.
- Active booking impact matrix and exact-location behavior under each approved disposition.
- Internal payment/webhook/transfer processing continues safely without request-auth bypass.
- Re-enable requires reapproval and does not auto-publish.
- Deletion orchestration resumes safely across internal/Supabase/provider failures and respects holds/retention.
- DTO/log/export tests for redaction and least privilege.

## Unresolved questions

- Which Admin roles and reason codes can disable/re-enable, and is dual approval required?
- Whether every Host disable hides listings immediately or only safety/fraud reasons do.
- Interim handling of paid/near-check-in stays when a Host is disabled.
- Which transfers are held/released during fraud, safety, legal, or support review.
- Identity verification method for deletion requests and appeal/re-enable process.
- Field-by-field retention, anonymization, backup, legal hold, and processor-deletion schedule.
- Whether/when Supabase sessions and account are revoked versus deleted.

## Approval needed

Product owner approval is required for listing/booking/re-enable behavior. Qualified privacy/legal, finance/tax, security, and provider/account-owner approval is required for deletion, retention, holds, payment/transfer handling, and Supabase/provider coordination.

## Status

**Blocked.** Phase 5.6B denial remains authoritative; lifecycle mutation and deletion wait for approved product/legal/financial policy.
