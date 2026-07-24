# ADR-013: Preserve the implemented Stripe marketplace model but block Live Mode pending financial/legal approval

- Date: 2026-07-19
- Status: Blocked

## Context

MediCN has implemented a technical marketplace flow, but technical fund movement does not decide Merchant of Record, escrow, tax, dispute liability, negative-balance responsibility, or bank-payout obligations. Those decisions require the Stripe account configuration, business owner, and qualified advisers.

## Source requirements

- [AGENTS.md](../../AGENTS.md): production marketplace decisions must explicitly cover merchant, liability, tax, fee, timing, refunds/disputes, and reconciliation.
- [Backend gap audit](../backend-final-gap-audit.md): Connect/payment mechanics are implemented but provider E2E and legal/business decisions remain.
- [Stripe Accounts v2](https://docs.stripe.com/connect/accounts-v2): recipient configuration enables transfer receipt.
- [Stripe charge types](https://docs.stripe.com/connect/charges) and [separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers): platform charges and transfers are distinct balance movements.
- [Stripe account balances](https://docs.stripe.com/connect/account-balances): transfers to connected Stripe balances are not external bank payouts and holding funds has risk/policy implications.
- [Stripe refunds/disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes): indirect-charge refunds/disputes debit the platform balance under the documented model.

## Decision

Document and preserve the existing technical baseline:

- Hosts onboard through Stripe Connect Accounts v2 `recipient` accounts using Stripe-hosted onboarding; MediCN does not collect bank/tax credentials.
- The customer charge is created on the platform.
- Host funds move through a separate delayed Stripe Transfer to the connected account.
- The platform fee is configurable and recorded as an immutable booking/payment/transfer accounting snapshot.
- Transfer release is eligible after the configured check-in delay and requires identity/Connect/payment/booking safeguards.
- Refunds, disputes, transfer reversals, and their retry/reconciliation states are tracked separately.
- A Stripe Transfer moves funds to a connected Stripe balance; it is not proof of a bank payout.
- MediCN must not describe the delay as legal escrow. No escrow relationship or protection is claimed by this technical design.

Before Live Mode, the following remain Blocked:

- Merchant/settlement-merchant legal conclusion and customer/Host contractual disclosures.
- Acceptance of platform and connected-account negative-balance responsibility under the actual Accounts v2 configuration.
- Refund, dispute, chargeback, Stripe-fee, and fraud-loss liability.
- Tax collection, remittance, reporting, forms, and Host classification.
- Final platform fee and who pays Stripe fees.
- Host transfer-release timing and any reserve/hold policy.
- Required bank-payout lifecycle visibility, payout failure handling, and support responsibility.
- Stripe account eligibility for the selected country, recipient agreement, capabilities, and fund flow.

## Alternatives

1. **Destination charges:** possible marketplace model but would change immediate fund flow and liability/accounting behavior; not selected without redesign.
2. **Direct charges:** would place charges on connected accounts and materially change merchant/customer/refund behavior; not selected.
3. **MediCN-collected bank details:** rejected; Stripe-hosted onboarding remains the sensitive-data boundary.
4. **Describe delayed transfer as escrow:** rejected because a technical balance delay is not a legal escrow determination.

## Consequences

- Existing test-mode engineering and reconciliation work may continue, but no Live Mode charges/transfers are authorized by this ADR.
- Financial settings cannot be promoted from environment defaults to business policy without signed approval.
- Provider sandbox certification and account configuration evidence are required in later phases.

## Backend invariants

- Backend-calculated amount/currency/fee/net values are authoritative and immutable per attempt/transfer.
- At most one active checkout attempt per booking; provider calls use stable idempotency.
- Webhook signatures/raw bodies, unique inbox events, monotonic transitions, and reconciliation remain mandatory.
- Transfer release is distinct from bank payout and never marks payout success.
- Refund/dispute processing reconciles booking access and transfer reversal without assuming provider event order.
- No bank/tax credential, card data, or provider secret enters application DTOs/logs.

## API implications

- Existing checkout, Connect onboarding/status, and provider webhook boundaries remain.
- Future Admin payment/transfer views must label `transfer` versus `payout` precisely.
- No public API may claim escrow, guaranteed payout, or legally final settlement.
- Reconciliation/operator APIs remain needed before production but must expose allowlisted provider references only.

## Data/privacy implications

- Stripe remains the processor for card, bank, identity, and tax onboarding data; MediCN stores only necessary provider IDs/readiness/accounting state.
- Financial records require approved retention/legal-hold and data-subject handling; deletion cannot erase statutory/audit obligations by default.
- Customer/Host terms and privacy disclosures must describe actual processors and responsibilities after legal review.

## Tests required

- Existing unit/PostgreSQL concurrency suites plus Stripe Test Mode/CLI scenarios for onboarding, asynchronous success/failure, expiry, duplicates, amount mismatch, refunds, disputes, delayed transfer, reversal, and failures.
- Actual Accounts v2 capability/responsibility snapshot validation.
- Transfer-versus-payout DTO/copy tests and no-escrow terminology checks.
- Reconciliation and operator recovery for missed/out-of-order webhooks.
- Negative-balance/refund/dispute failure drills with no live money in automated tests.

## Unresolved questions

- All eight Blocked Live Mode decisions above.
- Whether the actual Stripe account/country supports the implemented recipient model.
- Whether `on_behalf_of`, statement descriptor, cross-border, or funds-segregation behavior is required.
- Who owns downstream bank-payout support and reconciliation.

## Approval needed

Founder/business approval, qualified legal/tax advice, and Stripe account/provider confirmation are required. Each decision must be recorded with owner/date/evidence before Live Mode.

## Status

**Blocked.** The technical model is documented, but it is not legal approval, escrow, tax advice, or authorization for Live Mode.

## Phase 5.9A implementation evidence (2026-07-19)

Backend operational reads and explicit reconciliation are implemented without
changing this ADR's Blocked status:

- Admin-only bounded Payment, HostTransfer, JobExecution, failed/dead-letter,
  and OperationalCommand views use allowlisted serializers. Provider IDs occur
  only on Admin detail responses; webhook payloads, raw errors, secrets,
  payment methods, bank data, notes, addresses, and email content are omitted.
- Booking Renter, Host, and Admin can read a booking-scoped lifecycle summary.
  Unrelated and missing bookings both return opaque `NOT_FOUND`; participant
  output contains no provider identifiers.
- Requeue and reconciliation create an audited `OperationalCommand` and an
  opaque Outbox payload containing only `operationalCommandId` in one database
  transaction. The operations worker owns execution and durable retries.
- Reconciliation is explicit, stale-only, and bounded to 25 candidates. It
  uses the existing monotonic webhook/payment transitions and full aggregate
  lock order. Reads and startup perform no Stripe calls; automated tests use
  provider mocks only.
- Transfer DTOs state `stripe_transfer_to_connected_balance` and
  `representsBankPayout: false`. Reconciliation observes a Stripe Transfer or
  reversal; it does not create a payout or assert bank receipt.

These controls improve Test Mode operational safety only. They do not resolve
merchant-of-record, fees, taxes, dispute/refund liability, reserves, negative
balances, payout support, country eligibility, or any other Live Mode blocker.
