# AGENTS.md

This file defines how AI coding agents should work in the MediCN project.
Follow it before writing or changing code.

## Project Source of Truth

When requirements conflict, use this priority order:

1. `../MediCN-Weekly-Report/Week2/API-Design.md`
2. `../MediCN-Weekly-Report/Week2/ERD-Database-Backend.md`
3. Notion Week 3 and Week 4 tasks from `../_extracted_export`
4. Tech Docs & Architecture from the Notion export

Week 1 and Week 2 documents describe the project foundation. Week 3 auth work and Week 4 listings work start from those decisions instead of replacing them.

## Tech Stack

- Frontend: Next.js, TypeScript, Tailwind CSS, Supabase Auth
- Backend: NestJS, TypeScript, Prisma, PostgreSQL, Supabase Auth token verification
- Monorepo layout:
  - `apps/web` for the Next.js frontend
  - `apps/api` for the NestJS backend
  - `packages/types` for shared frontend/backend contracts

## Agent Skills Requirement

All coding work must reference the local `../agent-skills` repository.

Use these skills by default:

- New feature or significant change: `spec-driven-development`
- Task breakdown: `planning-and-task-breakdown`
- Multi-file implementation: `incremental-implementation`
- Behavior or logic changes: `test-driven-development`
- API, type, or module boundary work: `api-and-interface-design`
- Authentication, authorization, user input, secrets, or external service work: `security-and-hardening`
- Frontend UI work: `frontend-ui-engineering`

Do not skip verification steps from the applicable skill. Tests, type checks, builds, or manual smoke checks must be reported with the result.

## Week 3 Scope

Week 3 focuses on the authentication path from frontend to backend to database.

Backend scope:

- Verify Supabase Auth access tokens on protected API requests.
- Implement `GET /api/v1/auth/me`.
- Implement `POST /api/v1/auth/sync`.
- Implement current-user profile endpoints as needed for auth onboarding.
- Derive renter/host roles from Supabase signup metadata during `POST /api/v1/auth/sync`.

Frontend scope:

- Build only the minimum UI needed to support backend auth testing.
- A user should be able to sign in or sign up through Supabase Auth.
- The frontend should obtain a Supabase access token and call the backend auth endpoints.
- The frontend should display basic authenticated user state, loading states, and error states.

Out of scope for Week 3:

- Full visual design system
- Listing creation/search
- Payments
- Veriff verification
- Messaging
- Admin moderation dashboards
- Production deployment

## Week 4 Scope

Week 4 focuses on listings marketplace functionality. The milestone is that users can view, add, and search property listings.

Backend scope:

- Build listing CRUD endpoints from the Week 2 API design:
  - `GET /api/v1/listings`
  - `GET /api/v1/listings/:id`
  - `POST /api/v1/listings`
  - `PATCH /api/v1/listings/:id`
  - `DELETE /api/v1/listings/:id`
- Use the Week 2 ERD structures for `Listing`, `ListingPhoto`, `ListingAvailability`, and `ListingPlace`.
- Store money as `priceCents`; do not persist decimal money values.
- Keep listing `status`, `deletedAt`, host ownership, and soft-delete/archive behavior consistent with the Week 2 ERD.
- Public listing search and details should expose only active approved listings unless an owner/admin flow explicitly needs otherwise.
- Protected create, update, delete, and photo endpoints must enforce Supabase token auth plus host owner/Admin access rules.
- Keep all listing API responses and errors inside the shared Week 2 response envelope.

Full-stack scope:

- Connect listing cards, listing detail views, and the search interface to backend listing endpoints.
- Integrate search logic, filters, pagination, and sorting using the Week 2 listing query parameters.
- Implement controlled image upload through `POST /api/v1/uploads/presigned-url` and `POST /api/v1/listings/:id/photos`.
- Use Supabase access tokens for protected create, update, delete, and upload flows.
- Display useful loading, empty, success, and error states for listing search, creation, and photo upload flows.

Out of scope for Week 4:

- Payments
- Bookings
- Messaging
- Veriff verification workflows
- Admin moderation dashboards
- Production deployment
- Accepting arbitrary external image URLs instead of backend-generated storage paths

## Week 5 Scope

Week 5 is the midpoint evaluation and refinement week. It does not introduce a
new end-user feature by default; its purpose is to verify the Week 4 foundation,
resolve the highest-value technical debt, and prepare a clear integration plan
for the next sprint.

### Backend & Database

Notion task: **Participate in midpoint evaluation and address technical debt in
database structure.**

- Review the Week 4 Prisma schema, migrations, data integrity rules, and query
  patterns against the Week 2 ERD and API design.
- Verify listing indexes and query behavior with representative data before
  adding performance indexes or migrations; do not make speculative schema
  changes.
- Resolve confirmed database or API data-consistency issues involving listing
  status, ownership, soft deletion, availability, photos, and storage paths.
- Add or improve automated coverage for confirmed backend gaps, especially
  validation, authorization, ownership, soft-delete, and error-envelope paths.
- Record decisions, remaining technical debt, and deferred work in the API or
  architecture documentation.

### Full-Stack & Integrations

Notion task: **Participate in midpoint evaluation and refine API performance and
integration roadmap.**

- Evaluate listing search, filtering, pagination, and image-upload API behavior
  for performance, response consistency, and failure modes.
- Validate protected API and Supabase Storage flows with real integration
  checks when credentials and a safe test environment are available.
- Produce and maintain a frontend integration handoff: endpoint inventory,
  authorization requirements, request/response examples, error states, and the
  controlled two-step listing-photo upload flow.
- Identify dependencies blocked on frontend work, record them explicitly, and
  define the next integration order. Do not mark a UI-dependent flow complete
  until it has been integrated and smoke-tested with the frontend.

### Week 5 Boundaries

- Do not add Stripe, Veriff, Google Maps, booking, messaging, review, or admin
  features solely to fill Week 5 time; they require a separately approved
  follow-on scope.
- No frontend is required to complete the backend review, API tests, Supabase
  integration checks, documentation, or integration handoff deliverables.

## Week 6 Scope

Week 6 introduces integration infrastructure for the formal MediCN website. The
official frontend is being developed separately and has not been merged into this
repo yet; the current `apps/web` frontend is only a temporary local test surface.
Use it for smoke testing API behavior when helpful, but do not mark a feature as
fully frontend-integrated until the official frontend flow is merged and tested.

### Backend & Database

Notion task: **Set up background workers and automated transactional email
dispatching.**

Work that can be done before formal frontend integration:

- Add a provider-agnostic background job and transactional email foundation:
  module boundaries, typed job payloads, retry/idempotency behavior, structured
  logging, and unit tests.
- For a production-like Week 6 backend, use the Postgres Outbox + Redis/BullMQ
  pattern for transactional jobs:
  - Business flows such as booking creation and payment completion must write an
    `OutboxEvent` inside the same Prisma transaction as the related business
    record.
  - A publisher process should move pending outbox events into BullMQ queues
    backed by Redis, using stable job IDs/idempotency keys so retries are safe.
  - A worker process such as `npm run worker:email -w apps/api` should consume
    BullMQ jobs and call the provider-agnostic email adapter.
  - Automated tests must mock or fake BullMQ/Redis boundaries; unit tests should
    not require a live Redis server.
- Use a safe local/dev email adapter first. Supabase owns auth emails, so MediCN
  transactional email should focus on app events such as booking, inquiry,
  payment, verification, and admin-decision notifications as those backend
  events become available.
- Keep the outbox schema minimal and tied to actual Week 6 event flows. Do not
  add speculative job tables, dashboards, or workflow engines beyond the
  transactional outbox, BullMQ queue adapter, email worker, and smoke command.
- Keep secrets in environment variables, document any new variables in
  `.env.example`, including `REDIS_URL` and worker poll settings. Missing email
  provider credentials should fail safely in development and tests; missing
  Redis should only block publisher/worker commands that actually need Redis.
- Verify worker behavior through unit tests, service-level tests, and explicit
  smoke commands or fixtures. A formal UI is not required for this backend
  milestone.

Frontend-dependent or deferred:

- Final email copy tied to real product screens, user notification preferences,
  and complete user-facing delivery QA.
- Production email-provider enablement unless credentials and send-domain setup
  are approved.

### Full-Stack & Integrations

Notion task: **Integrate third-party tools: mapping API and basic Stripe payment
prep.**

Work that can be done before formal frontend integration:

- Mapping API prep:
  - Add a server-side maps/geocoding service behind an interface and mock it in
    tests.
  - Enrich existing listing address/place data where useful: `latitude`,
    `longitude`, `ListingPlace.googlePlaceId`, and `ListingPlace.mapsUrl`.
  - Keep `GET /api/v1/listings` and `GET /api/v1/listings/:id` response shapes
    compatible with the current listing contracts.
  - Use a server-only maps key for backend calls, for example
    `GOOGLE_MAPS_SERVER_API_KEY`. Do not use `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
    from backend code except as a documented future frontend key.
  - Fail soft when maps credentials are absent: preserve labels and generate or
    retain safe Google Maps search URLs instead of blocking listing creation.

#### Listing Location Privacy And Map Experience

MediCN follows an Airbnb-style location disclosure model. Hosts provide an
accurate full address, but the public marketplace must not expose the street
number, unit number, exact coordinates, or another value that can be used to
reconstruct the precise property location.

Host address capture:

- The host-facing form should collect one human-readable address through Google
  Place Autocomplete. Hosts must not be expected to type latitude or longitude.
- The frontend may submit the selected formatted address and an optional Google
  Place ID, but the backend remains authoritative: resolve and persist the full
  address and exact coordinates server-side before approving a listing.
- If geocoding is unavailable or ambiguous, preserve the host's input and mark
  location resolution as incomplete. Do not silently substitute an unrelated
  location or publish a precise marker that the host has not confirmed.
- Listing owners and admins may retrieve the exact saved address and coordinates
  for listing management and moderation.

Public location contract:

- Public listing search and `GET /api/v1/listings/:id` must return only a safe
  public location representation: city, optional host-approved neighborhood,
  approximate map center, and an approximation radius/precision indicator.
- Generate the approximate map center server-side. It must be stable for the
  listing, visibly displaced or coarsened enough to protect the street address,
  and must never be calculated in browser code from exact coordinates.
- Public serializers must omit the full `address`, unit/apartment details, exact
  `latitude`/`longitude`, and exact-location Place IDs. Do not rely on the
  frontend to hide sensitive fields that the API already returned.
- Public UI copy should identify the map as `Approximate location` and may show
  city/neighborhood text. It must not imply that the public marker is the front
  door or check-in point.

Confirmed-booking location contract:

- The booking's renter may receive a `checkInLocation` containing the complete
  address and exact coordinates only when the booking status is `paid` or
  `completed`.
- A cancelled, fully refunded, disputed, or rejected reservation must not expose
  `checkInLocation`, even if it was paid previously. A partial refund alone may
  retain access only while the booking remains `paid|completed`, the stay is
  fulfillable, and no full-refund/dispute/cancellation revocation exists, as
  specified by ADR-007. Exact-location access must use the authoritative current
  booking and aggregate payment state, not a historical `paidAt` value alone.
- `requested`, `accepted`, `payment_pending`, `rejected`, and `cancelled`
  bookings must not expose `checkInLocation` to the renter.
- The booking host and admins may access the exact location for authorized
  operational flows regardless of public visibility.
- Prefer returning the optional `checkInLocation` from the authorized booking
  detail contract, or from a dedicated protected booking-location endpoint. In
  either design, authorization and status checks must happen in the backend
  service before serialization.
- Add tests proving that anonymous users, unrelated authenticated users, and
  renters without a paid/completed booking cannot obtain exact location data.

Nearby-place enrichment:

- Use the listing's exact server-side coordinates to find useful nearby places,
  prioritizing hospitals/medical centers, public transit, pharmacies, grocery
  stores, and host-curated local recommendations.
- Public responses may contain place name/type, rounded approximate distance,
  and a safe Google Maps place URL. They must not contain the exact listing
  coordinates or a directions URL whose origin reveals the property.
- Label straight-line distance as approximate. Add walking/driving time only
  when it comes from a routes provider response; do not estimate travel time in
  frontend code.
- Cache provider results with a bounded lifetime and refresh them when the host
  changes the address. Maps/Places outages must degrade to the public city and
  approximate map rather than block listing detail.
- Keep `GOOGLE_MAPS_SERVER_API_KEY` server-only. Browser map rendering uses a
  separately restricted browser key and never receives the server key.
- Stripe payment prep:
  - Add a Stripe-facing service/module with dependency isolation, mocked tests,
    environment validation, and no real network calls in automated tests.
  - Before creating checkout sessions, implement or verify the minimal Week 2
    booking backend flow needed by payments: `POST /api/v1/bookings`,
    `GET /api/v1/bookings`, and `GET /api/v1/bookings/:id`, or clearly mark
    Stripe work as service-only prep until a booking record exists.
  - Implement `POST /api/v1/payments/checkout-session` only against backend
    calculated amounts from `Booking`/`Listing`; never trust frontend-sent
    amounts.
  - Implement `POST /api/v1/webhooks/stripe` with signature verification and
    tested handling for checkout completion, payment success, payment failure,
    refund, and dispute events.
  - Persist `Payment` records using the existing Week 2 schema fields and keep
    errors inside the shared API envelope.
- The temporary frontend or an API client may be used to call endpoints and
  confirm happy/error paths while the official frontend is unmerged, but they are
  not a substitute for formal frontend integration.

Frontend-dependent or deferred:

- Map widgets, browser autocomplete, visible map marker UX, and frontend API-key
  exposure rules.
- Checkout buttons, redirect/return-page UX, and real end-to-end payment QA in
  the official frontend.
- Production payment enablement, live Stripe keys, webhook endpoint deployment,
  and real charges.

Suggested implementation order:

1. Update Week 6 environment documentation and typed config for optional email,
   maps, Stripe, Redis, and worker settings.
2. Build and test the maps service, then connect it to listing place/address
   enrichment without breaking current listing APIs.
3. Build and test the Postgres outbox model, BullMQ queue adapter, publisher,
   worker command, and local/dev email adapter.
4. Add the minimal booking backend prerequisite if Stripe checkout needs real
   booking records.
5. Build and test the Stripe checkout/webhook prep around backend-calculated
   amounts and existing `Payment` schema.
6. Smoke-test with the temporary frontend, API client, or worker smoke command,
   then document what is ready for the official frontend merge and what still
   needs formal UI wiring.

Week 6 is not complete just because third-party SDKs are installed. It is
complete when backend contracts, safety boundaries, tests, environment docs, and
remaining frontend blockers are explicit.

## Production Rental Platform Follow-On

Week 6 third-party work is infrastructure and payment preparation. It must not
be described as a production-ready rental marketplace until the requirements in
this section are implemented and verified in provider test/sandbox environments.

### Marketplace Payments And Host Payouts

MediCN is a multi-party rental marketplace, not a single-merchant online store.
The production payment design must explicitly decide the merchant of record,
refund/dispute liability, tax responsibility, platform fee, and payout timing.
Unless that product/legal decision changes, use Stripe Connect with hosted or
embedded Stripe onboarding for Hosts; do not collect bank-account or taxpayer
credentials in MediCN forms.

- Store the Host's Stripe connected-account identifier and non-sensitive
  readiness fields such as onboarding complete, charges enabled, payouts
  enabled, and requirements due. Never store bank account numbers from Stripe.
- Do not allow a Host to receive paid bookings until the connected account is
  eligible for the chosen charge and payout model.
- For a one-Host booking where MediCN holds funds until check-in, prefer a
  Connect design that supports delayed transfer/payout and a clearly recorded
  platform fee. Implement payout release, payout failure, refund, dispute, and
  reconciliation states before live money is enabled.
- A booking acceptance must start a bounded payment window. Persist its expiry,
  release or re-open inventory when checkout expires, and handle
  `checkout.session.expired` plus delayed-payment success/failure events.
- Allow at most one active Checkout Session/payment attempt for a booking.
  Create sessions with a stable Stripe idempotency key and enforce the same
  invariant in PostgreSQL/transactional application logic.
- Never mark a booking paid merely because the browser reached a success URL.
  Before fulfillment, verify the provider object, `payment_status`, booking
  metadata, amount, and currency against backend records.
- Preserve Stripe's raw webhook body and verify signatures with the official
  Stripe library. Record every Stripe event ID in a unique webhook-inbox table
  before processing so duplicate and concurrent deliveries are idempotent.
- A webhook endpoint should authenticate, persist the event, and acknowledge it
  quickly. Perform longer business work through a transactional/outbox worker.
  State transitions must be monotonic and safe when events arrive out of order.
- Refund and dispute handling must update both `Payment` and the booking/access
  policy. A refunded/cancelled reservation must not retain exact check-in
  location access.
- Prevent double booking under concurrency at the database/transaction boundary;
  an application-level availability check followed by a separate insert is not
  sufficient for a system that can collect money.
- Add Stripe CLI/test-mode integration tests for duplicate events, invalid
  signatures, asynchronous methods, expired sessions, amount mismatch, refund,
  dispute, and payout failure. Automated unit tests must still avoid live money.

### Booking Cancellation Boundary

ADR-006's baseline actor/state matrix is accepted. Implement it without
inventing a paid-Renter refund policy.

- A Renter may cancel `requested` and unpaid `accepted` bookings. No funds were
  collected, so these flows perform no refund operation and user-facing copy
  must not imply that money was retained.
- A Renter may cancel `payment_pending` only while funds remain unsettled. Void
  or expire the active Checkout flow; if payment settles concurrently, fail
  closed and reconcile through the required full-refund path.
- Paid-Renter self-service cancellation remains unavailable and must return a
  stable policy-unavailable error until refund timing, percentage, fees,
  exceptions, and liability are approved.
- Keep Host rejection for `requested` bookings. Host/Admin cancellation of a
  paid future booking requires full-refund orchestration and any required Host
  transfer reversal; it must never mark cancellation financially complete from
  a browser redirect or an unconfirmed provider request.
- `completed`, `rejected`, and `cancelled` are terminal for ordinary APIs;
  repeated cancellation of an already-cancelled booking is idempotent.
- Every cancellation records actor, allowlisted reason, effective time, and
  financial disposition, and is serialized against payment success, checkout
  expiry, refund, dispute, Host decision, inventory release, and transfer
  release. Cancellation, audit, reservation effects, and Outbox events must be
  transactionally coherent.

Reference: Stripe Connect marketplace and webhook guidance:
`https://docs.stripe.com/connect/marketplace/essential-tasks` and
`https://docs.stripe.com/webhooks`.

### Identity And Healthcare Verification

Supabase email confirmation is authentication hygiene; it is not identity,
healthcare credential, Host payout, or property verification.

- Implement Veriff behind a backend service boundary. The frontend requests a
  session from MediCN and opens the provider-hosted flow; it must never receive
  `VERIFF_SECRET` or construct trusted verification decisions.
- Bind each Veriff session to the authenticated internal user through an opaque
  `vendorData`/end-user identifier and persist the provider session ID.
- Verify Veriff webhook `X-AUTH-CLIENT` and raw-body HMAC signatures. Store a
  unique event/delivery identity and process callbacks idempotently because
  delivery is at least once and event order is not guaranteed.
- Browser redirects and frontend callbacks mean only `submitted` or `returned`;
  only a verified backend webhook/provider lookup may set `approved`, `rejected`,
  or `expired`.
- Require approved identity before a Host can publish a listing or become payout
  eligible, and before a Renter can submit/pay for a booking. Browsing public
  listings must remain available without identity verification.
- Government-ID identity verification does not prove that someone is a doctor,
  nurse, or medical student. Keep healthcare affiliation/license verification as
  a separate status and review workflow; never infer it from Veriff approval.
- Healthcare credential evidence follows
  `docs/adr/ADR-016-temporary-healthcare-evidence.md`. Require approved identity
  before a user may submit evidence, but never let an identity event create,
  approve, reject, expire, or otherwise mutate healthcare verification state.
- Store healthcare evidence only in a dedicated private
  `healthcare-credentials` bucket. Never use listing-photo, avatar, or another
  public bucket, and never expose a public or stable evidence URL.
- Healthcare evidence v1 accepts at most three JPEG, PNG, or WebP images per
  submission and at most 10 MB per file. PDF, OCR, active document formats,
  identity documents, selfies, dates of birth, home addresses, and full
  license/student/employee numbers are outside the approved boundary.
- Keep uploads quarantined until server-side magic-byte inspection, decode and
  resource limits, re-encoding, orientation normalization, and EXIF/GPS removal
  produce a sanitized private derivative. Delete the original after that
  derivative is confirmed ready; Admin reviews the derivative, not the original.
- Only an authorized Admin may request evidence access. Generate the signed URL
  server-side with a maximum 60-second lifetime, never persist or log it, and
  write a bounded audit event for every view request.
- Approval, rejection, or user withdrawal must durably enqueue deletion of all
  remaining healthcare evidence. Use opaque IDs in Outbox/BullMQ payloads,
  resolve storage paths server-side, retry idempotently, and mark evidence
  deleted only after the Storage API confirms removal. Surface terminal cleanup
  as `deletion_failed` with operations visibility; never silently discard it.
- After evidence deletion, retain only minimum claim, decision, reviewer, audit,
  and deletion metadata. Never retain image bytes, thumbnails, OCR text, signed
  URLs, or extracted credential content in application records, logs, metrics,
  email, queues, or unrestricted audit metadata.
- Public copy may state only that information was reviewed by MediCN. It must not
  claim Veriff, government, employer, school, or licensing-board certification.
  Public production collection remains blocked until privacy/legal, disclosure,
  reviewer-process, incident, data-residency, appeal, backup, and audit-retention
  decisions are approved.
- Do not upload identity documents or selfies to the public listing/profile
  bucket. Prefer provider-hosted retention. If MediCN must retain sensitive
  evidence for an approved legal purpose, use a dedicated private bucket,
  least-privilege access, audit logs, encryption, and a documented deletion
  schedule.
- Store only the minimum provider result/status required by product and legal
  policy. Never return document images, document numbers, or raw provider payloads
  in public/current-user DTOs.

Reference: Veriff webhook and HMAC guidance:
`https://devdocs.veriff.com/docs/webhooks-guide`.

### Media Upload Security

Signed upload URLs and controlled object paths are only the ingestion boundary.
An uploaded object is not publishable until server-side processing marks it
ready.

- Maintain media states such as `uploaded`, `processing`, `ready`, and
  `rejected`; public listing/profile DTOs should expose only `ready` derivatives.
- Inspect actual magic bytes and decode the image rather than trusting filename
  extension or browser `Content-Type`.
- Re-encode accepted images, remove EXIF/GPS and other unnecessary metadata,
  enforce dimensions/pixel count/file size, normalize orientation, and generate
  stable thumbnail/display variants.
- Keep immutable UUID-based object paths, never overwrite CDN objects in place,
  and delete superseded, rejected, expired-intent, and otherwise orphaned files.
- Listing photos and public profile avatars may use a public delivery bucket only
  after sanitization. Identity, moderation evidence, private messages, and future
  check-in documents require separate private storage and authorized signed
  downloads.
- Healthcare credential evidence is a purpose-specific exception governed by
  ADR-016: it remains private before and after sanitization, uses separate object
  paths and DTO allowlists, is never publishable, and must pass through the
  `processing`, `pending_review`, `deletion_pending`, and provider-confirmed
  deletion lifecycle. Generic media cleanup must not accidentally publish,
  orphan, or indefinitely retain these objects.
- Add processing failure, spoofed MIME, malformed image, oversized image, EXIF
  removal, ownership, and cleanup tests.

### Transactional Delivery And Worker Operations

The Postgres Outbox + BullMQ design remains the required durability boundary,
but `enqueued` means accepted by Redis, not delivered by Brevo.

- Make the email adapter return the provider message ID and persist delivery
  attempts/status separately from the business transaction.
- Add an authenticated Brevo transactional webhook for delivered, deferred,
  soft/hard bounce, blocked, complaint, and error events. Deduplicate webhook
  events and suppress or flag addresses after permanent failure/complaint.
- Keep email payloads minimal; do not place exact addresses, identity data,
  access tokens, or unnecessary medical information in queue payloads/logs.
- Provide dead-letter inspection and explicit requeue/reconciliation commands.
  A BullMQ failure must be reflected in durable operational state rather than
  remaining visible only inside Redis.
- Production Redis must use authentication and TLS (`rediss://`) where provided,
  a queue-safe `noeviction` policy, connection/error listeners, readiness checks,
  and metrics/alerts for queue depth, failures, retries, and outbox age.
- Queue producers should fail within a bounded time during Redis outages, while
  Workers may keep reconnecting. Workers must handle `error`, `failed`,
  `SIGINT`, and `SIGTERM` and shut down gracefully.
- In production, enabled critical providers must be validated at startup. Do not
  silently substitute the local email adapter when transactional email is
  required. All provider HTTP calls need timeouts; retries must be safe and
  idempotent.

Reference: Brevo delivery events and BullMQ production guidance:
`https://developers.brevo.com/docs/transactional-webhooks` and
`https://docs.bullmq.io/guide/going-to-production`.

## Authentication Decision

MediCN uses Supabase-first authentication.

- Supabase Auth owns signup, login, logout, password reset, email verification, and session creation.
- The backend verifies Supabase access tokens and maps Supabase users to internal MediCN users.
- Do not create custom password authentication unless the project requirements are explicitly changed.
- Do not store plaintext passwords.
- Do not add password hashes or custom password tables for Week 3.

## API Rules

- Base path: `/api/v1`
- Protected endpoints expect `Authorization: Bearer <supabase_access_token>`.
- Use the shared response envelope from the Week 2 API design:

```json
{
  "data": {},
  "meta": {},
  "error": null
}
```

```json
{
  "data": null,
  "meta": {},
  "error": {
    "code": "ERROR_TYPE",
    "message": "Error message",
    "details": {}
  }
}
```

- Validate external input at API boundaries.
- Keep error shapes consistent across endpoints.
- Do not expose stack traces or secrets in API responses.

## Frontend Rules

The Week 3 frontend is intentionally minimal.

- For Week 3, prefer clear, testable auth flow over polished visuals.
- For Week 3, include basic loading, success, and error states for auth.
- Keep UI components small and accessible.
- Do not add large UI libraries unless they are required for the auth flow.
- During Week 3 auth work, do not build listing, payment, verification, or messaging screens.

## Testing and Verification

Before considering a change complete:

- Backend auth behavior must have tests for success and failure paths.
- Supabase signup metadata must only map supported renter/host roles and must ignore attempts to self-assign `admin`.
- Invalid or missing Supabase tokens must return structured auth errors.
- Frontend auth integration must be smoke-testable with a Supabase access token.
- Type checks and lint/build commands should pass once the project tooling exists.

Before considering Week 4 listing work complete:

- Backend listing CRUD behavior must have tests for success, validation errors, missing auth, wrong role, non-owner update/delete, and soft-delete/archive behavior.
- Search and filter tests must cover city, price, listing type, stay duration, sort, pagination, and hidden/non-approved listing exclusion.
- Photo upload tests must verify that only backend-generated storage paths are accepted.
- Full-stack smoke checks must confirm unauthenticated users can view/search listings and authenticated hosts can create listings and attach photos.

If a command cannot run because dependencies or environment variables are missing, report the exact blocker and the command attempted.

## Boundaries

Always do:

- Keep changes scoped to the current task.
- Preserve Week 2 API and ERD decisions unless a later approved plan changes them.
- Use environment variables for secrets.
- Keep `.env.example` safe to commit.
- Write tests for new behavior.

Ask first:

- Adding a new authentication provider.
- Changing the API response envelope.
- Changing the database schema away from the Week 2 ERD.
- Adding production-only infrastructure.
- Adding paid third-party integrations beyond placeholders.

Never do:

- Commit real `.env` files or secrets.
- Store plaintext passwords.
- Build custom password auth for Week 3.
- Skip tests for auth or authorization behavior.
- Modify `../MediCN-Weekly-Report`, `../agent-skills`, `../notion_export*`, or `../_extracted_export` as part of project implementation.
- Refactor unrelated code while implementing a scoped task.
