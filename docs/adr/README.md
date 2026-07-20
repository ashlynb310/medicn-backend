# MediCN architecture decision records

This directory continues the ADR numbering established in the Notion Tech Docs & Architecture page, where ADR-001 through ADR-003 cover NestJS, Prisma, and Vercel.

| ADR | Decision | Status |
| --- | --- | --- |
| [ADR-004](ADR-004-week-7-messaging-mvp.md) | Week 7 Messaging MVP | Accepted |
| [ADR-005](ADR-005-existing-listing-email-policy.md) | Existing-listing email-verification policy | Accepted |
| [ADR-006](ADR-006-booking-cancellation-policy.md) | Booking cancellation framework; paid-Renter policy remains blocked | Accepted |
| [ADR-007](ADR-007-partial-refund-location-access.md) | Partial-refund check-in-location access | Accepted |
| [ADR-008](ADR-008-listing-archive-policy.md) | Listing archive with active bookings | Accepted |
| [ADR-009](ADR-009-local-availability-policy.md) | Local availability and reservation projection | Accepted |
| [ADR-010](ADR-010-booking-completion.md) | Booking completion | Proposed |
| [ADR-011](ADR-011-reviews.md) | Reviews | Deferred |
| [ADR-012](ADR-012-healthcare-credential-review.md) | Healthcare credential review baseline; evidence prohibition superseded by ADR-016 | Accepted |
| [ADR-013](ADR-013-stripe-marketplace-boundary.md) | Stripe marketplace and Live Mode boundary | Blocked |
| [ADR-014](ADR-014-maps-retention-and-attribution.md) | Maps retention, provider choice, and attribution | Blocked |
| [ADR-015](ADR-015-account-lifecycle.md) | Account lifecycle | Blocked |
| [ADR-016](ADR-016-temporary-healthcare-evidence.md) | Temporary private healthcare evidence and deletion; production approval pending | Accepted |

Statuses have these meanings:

- **Accepted:** safe product decision that can be adopted now.
- **Proposed:** recommended design requiring owner approval.
- **Blocked:** legal, provider, account, or policy approval is required.
- **Deferred:** explicitly outside the current backend milestone.

The cross-ADR implementation and approval view is in [Phase 5.6C decision summary](../phase-5.6C-decision-summary.md).
