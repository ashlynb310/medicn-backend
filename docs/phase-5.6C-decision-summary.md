# Phase 5.6C decision summary

Date: 2026-07-19  
Scope: documentation and decision design only. No application, Prisma schema, migration, dependency, frontend, or test changes are authorized by this summary.

## Outcome

Phase 5.6C establishes a traceable product/workflow boundary for the remaining backend work. It does not claim legal, tax, provider, account, or production approval. Detailed records are indexed in [docs/adr](adr/README.md).

## Accepted decisions

| ADR | Accepted boundary | Implementation effect |
| --- | --- | --- |
| [ADR-004](adr/ADR-004-week-7-messaging-mvp.md) | Select first-party Messaging MVP over external calendar sync; participant/Admin authorization, read cursor, per-user archive, Outbox email, no attachments/provider/contact leakage. | Phase 5.7A is implemented, including bounded Socket.IO realtime notification and REST catch-up. |
| [ADR-005](adr/ADR-005-existing-listing-email-policy.md) | Unverified Hosts may prepare draft/pending listings; new approval/reapproval requires verified email; existing approved listings are grandfathered. | Current Phase 5.6B gate stands; future restore/reapproval must reuse it. |
| [ADR-006](adr/ADR-006-booking-cancellation-policy.md) | Renter/Host/Admin cancellation is approved for requested and unpaid states; paid Host/Admin cancellation requires full-refund orchestration; paid-Renter self-service remains blocked. | Phase 5.8A's unambiguous cancellation framework is unblocked without selecting refund percentages. |
| [ADR-007](adr/ADR-007-partial-refund-location-access.md) | Partial refund alone retains exact-location access for a still-paid/fulfillable booking; cancellation/full refund/dispute revoke. | Access-control regression fix is unblocked. |
| [ADR-008](adr/ADR-008-listing-archive-policy.md) | Host archive is blocked by future `requested|accepted|payment_pending|paid` bookings; Admin emergency hide is separate/audited. | Archive hardening is unblocked. |
| [ADR-009](adr/ADR-009-local-availability-policy.md) | Local available/blocked windows plus server-derived reservation projection; requested bookings reserve; half-open local civil dates and IANA timezone; external sync deferred. | Availability CRUD/projection work is unblocked; request expiry remains a follow-up decision. |
| [ADR-012](adr/ADR-012-healthcare-credential-review.md) | Healthcare review is Admin-decided and completely separate from Veriff; its original evidence prohibition is superseded by ADR-016. | The separation, history, minimization, and truthful-copy baseline remains authoritative. |
| [ADR-016](adr/ADR-016-temporary-healthcare-evidence.md) | Allow bounded temporary evidence images in a dedicated private bucket, sanitized Admin review, audited short-lived access, and durable deletion after decision or withdrawal. | Phase 5.7B implementation and controlled testing are unblocked; public production collection still requires privacy/legal and operational approval. |

## Proposed decisions needing owner approval

| ADR | Recommendation | Approval needed |
| --- | --- | --- |
| [ADR-010](adr/ADR-010-booking-completion.md) | Idempotent operations scheduler completes eligible paid past-end stays, independent of bank payout, unless cancelled/disputed. | Product owner selects local completion instant, grace period, support blocks, notification, and correction policy. |

## Blocked legal/provider/account decisions

| ADR | Blocked area | Evidence required to unblock |
| --- | --- | --- |
| [ADR-013](adr/ADR-013-stripe-marketplace-boundary.md) | Stripe Live Mode: Merchant/settlement merchant, negative balances, refunds/disputes/fraud, tax, fee, Host timing, bank payouts, country/account capability. | Dated founder/business decision, qualified legal/tax review, and Stripe account/provider confirmation. |
| [ADR-014](adr/ADR-014-maps-retention-and-attribution.md) | Real production Maps provider, durable/cached field rights, booking snapshots, TTL/deletion, account region, Terms/Privacy, attribution. | Field-level retention/attribution matrix approved by product, privacy/legal, and provider account owner. |
| [ADR-015](adr/ADR-015-account-lifecycle.md) | Admin disable/re-enable, disabled-Host listing hide, active-booking/payment handling, deletion, retention/holds, Supabase/provider coordination. | Product lifecycle policy plus qualified privacy/legal/finance/security/provider review. |
| [ADR-006](adr/ADR-006-booking-cancellation-policy.md) paid portion | Paid-renter refund eligibility, windows, percentages, exceptions, fees, and economic liability. | Product/legal-approved cancellation and refund policy. |
| [ADR-016](adr/ADR-016-temporary-healthcare-evidence.md) production use | Collection of real credential evidence in public production. | Privacy/legal basis, user disclosure/consent, reviewer operations, incident handling, data residency, audit retention, appeal, and production storage approval. |
| [ADR-012](adr/ADR-012-healthcare-credential-review.md) authoritative expansion | Automated school, employer, licensing-board, or other credential-source integration. | Provider feasibility, contracts, lawful purpose, disclosures, authoritative matching rules, and product approval. |

## Deferred features

- [ADR-011 Reviews](adr/ADR-011-reviews.md): Product Planning puts reviews/ratings post-MVP; reconsider only after completion is approved and implemented.
- External Google/Apple/iCal calendar synchronization; local availability is the milestone.
- Messaging attachments, external chat provider, typing indicators, reactions, group threads, and message editing/deletion.
- Healthcare PDF/OCR support, permanent evidence retention, and authoritative credential-provider integrations.
- Reciprocal Host-to-renter reviews unless explicitly approved later.

## Implementation phases now unblocked

1. **Phase 5.7A inquiry/messaging MVP:** implemented and locally accepted, including durable state, Socket.IO/Redis notification, REST catch-up, Outbox email, and gated concurrency tests.
2. **Phase 5.7B healthcare credential/Admin review:** unblocked for ADR-016's temporary private image evidence, sanitized Admin review, audited access, and provider-confirmed deletion; no PDF/OCR or authoritative-provider claims.
3. **Archive correctness work:** add active-booking block and `LISTING_ARCHIVE_BLOCKED_BY_ACTIVE_BOOKINGS` under ADR-008.
4. **Partial-refund exact-location correctness:** align authorization with continuing fulfillability under ADR-007.
5. **Phase 5.8B availability portion:** dedicated local available/blocked windows, reservation projection, protected-edit concurrency, and timezone/date model under ADR-009.

## Implementation phases still blocked or partially blocked

- **Phase 5.8A paid-Renter cancellation portion:** the baseline cancellation framework is accepted, but paid-Renter refund windows, percentages, fees, exceptions, and liability remain legally/product blocked.
- **Phase 5.8B completion portion:** blocked on owner approval of ADR-010 timing and exception rules.
- **Phase 5.8C reviews:** Deferred unless owner reaffirms ADR-011 after completion.
- **Payment/Admin operations and provider reconciliation:** test-mode engineering can continue, but Live Mode remains blocked by ADR-013.
- **Production Maps enablement:** blocked by ADR-014.
- **Admin account lifecycle/deletion:** blocked by ADR-015.
- Provider sandbox certification and production operations certification remain later phases.

## Recommended next implementation order

1. Phase 5.7B healthcare credential/Admin review under ADR-016; Phase 5.7A is complete.
2. Archive correctness and partial-refund exact-location alignment under ADR-008 and ADR-007.
3. Phase 5.8A cancellation framework for the now-approved unpaid/Host/Admin cases.
4. Paid-renter refund policy only after product/legal approval.
5. Phase 5.8B local availability, then completion after approval.
6. Phase 5.8C reviews only if reaffirmed.
7. Payment/Admin operations and provider reconciliation; Live Mode remains separately blocked.

## Questions the project owner must answer

### Messaging

1. Is there one open inquiry per renter/listing, or may separate date ranges have separate threads?
2. Are report/block controls required for the first public release?
3. Should obvious phone/email content be rejected or routed to moderation, and what is message retention?

### Cancellation, availability, completion, and reviews

4. Which paid-renter alternative applies, with what cutoffs, percentages, fees, exceptions, and liability? The unpaid Renter/Host/Admin baseline is already accepted.
5. How long may a requested booking reserve dates before expiry?
6. What listing-local checkout/completion instant and grace period apply, and do open support cases block completion?
7. Are reviews reaffirmed for Phase 5.8C? If yes, renter-only or reciprocal/double-blind, and what moderation/appeal policy?

### Healthcare trust

8. Which Admin roles and operating procedure govern evidence review, and what appeal, badge, expiry/renewal, audit-retention, legal-hold, backup, incident, and production-disclosure rules apply after evidence deletion?

### Stripe/finance

9. Who is the Merchant/settlement merchant under the actual Stripe configuration?
10. Who bears negative balances, refunds, disputes, chargebacks, fraud loss, and Stripe fees?
11. What platform fee, Host transfer timing/reserve, tax responsibility, and bank-payout support are approved?
12. Does the actual Stripe account/country support the Accounts v2 recipient and indirect-charge model?

### Maps/privacy/account lifecycle

13. Which Maps provider/agreement is approved, which returned fields may be stored for how long, and how are booking snapshots/attribution handled?
14. Should every disabled Host's approved listings be hidden immediately, and how are paid/near-check-in stays handled?
15. Which Admin roles/reasons may disable/re-enable, what appeals apply, and do listings require reapproval after re-enable?
16. What field-level retention, legal-hold, anonymization, backup, deletion, and Supabase/provider-deletion schedule is approved?

## Production statement

These ADRs are implementation guidance and an approval checklist. They do not constitute legal or tax advice, do not authorize live money or production Maps use, and do not establish that MediCN is production-ready.
