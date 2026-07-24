# Phase 5.9C payment return contract

This backend-only handoff freezes the Stripe Checkout return contract required
before frontend F3. It does not add or authorize a public success endpoint.

## Checkout creation

`POST /api/v1/payments/checkout-session` remains protected by Supabase bearer
authentication and returns the standard MediCN success envelope:

```json
{
  "data": {
    "checkoutSessionId": "cs_test_...",
    "checkoutUrl": "https://checkout.stripe.com/...",
    "expiresAt": "2026-07-20T18:30:00.000Z"
  },
  "meta": {},
  "error": null
}
```

`expiresAt` is an ISO 8601 timestamp. The response does not include Stripe
secret keys, webhook secrets, PaymentIntent secrets, or booking/payment data.
Amounts and currency continue to be calculated from the booking by the backend.

## Browser return URLs

Stripe Checkout is created with these configured frontend returns:

```text
/checkout/success?session_id={CHECKOUT_SESSION_ID}&bookingId=<encoded booking UUID>
/checkout/cancel?bookingId=<encoded booking UUID>
```

`bookingId` is only a stable locator for the authenticated frontend. Arrival at
the success URL, possession of either query parameter, or a browser redirect is
never proof that payment succeeded. The frontend must use its bearer token to
read the protected authoritative views:

```text
GET /api/v1/bookings/:id
GET /api/v1/bookings/:id/payment-summary
```

Payment state changes remain webhook-authoritative and continue to validate the
provider object, booking/payment metadata, amount, currency, and stored provider
references before fulfillment.

## Preserved controls

- The authenticated Renter must own the booking.
- The Renter must have a verified email and approved identity.
- The Host connected account must be Stripe Connect transfer-ready.
- At most one active Checkout attempt is reused with its stable idempotency key.
- No schema change or migration is part of Phase 5.9C.
- Automated tests mock Stripe; live Stripe calls are outside this handoff.
