# CLAUDE.md

Frontend agents must follow `AGENTS.md` first. This file adds concrete
requirements for integrating the code-complete MediCN backend into the existing
frontend. It replaces earlier assumptions that Week 6 provider contracts are
still missing.

## Current Backend Contract Authority

The backend is code-complete for the approved product scope. Do not infer API
contracts from UI needs and do not recreate backend state machines in the
browser. Read these local files before changing an integration:

1. `../medicn/docs/openapi.json` - authoritative HTTP paths, methods, request
   schemas, response schemas, authentication, and documented status codes.
2. `../medicn/docs/http-endpoint-inventory.md` - actor/authorization matrix and
   private-resource behavior for all 77 HTTP operations.
3. `../medicn/docs/socket-io-messaging-contract.md` - notification-only
   Socket.IO contract, sequence handling, and REST catch-up requirements.
4. `../medicn/packages/types/src/index.ts` - shared enums and domain contracts.
5. `../medicn/docs/backend-final-gap-audit.md` - implemented, deferred, and
   provider-blocked scope.

When sources differ, inspect the real backend controller/DTO/service and report
the conflict before coding. OpenAPI is authoritative for HTTP shape, while the
Socket.IO document is authoritative for realtime transport. Never edit backend
files from this repository.

## Existing Frontend Baseline

This is an incremental integration, not a redesign or greenfield rewrite.

- Current branch: `feat/frontend-phases-1-4`.
- Checkpoint commit `8d5f0b9` contains frontend Phases 1-4.
- The working tree also contains intentional Phase 4.5-4.7 work for Host-owned
  listings, booking decisions, Admin listing moderation, editable profiles, and
  processed profile-photo upload. Preserve and finish that work.
- Existing auth must continue to use the single `AuthProvider`/`useAuth` and the
  existing Supabase browser client. Do not add another session/token layer.
- Existing public search, listing detail, booking request/list/detail, Host
  listing create/photo flow, Admin listing moderation, and account profile are
  real integrations. Extend them instead of replacing them.
- Keep the current visual language, layout primitives, form components, status
  badges, loading/empty/error states, and responsive navigation.
- Never add hardcoded listings, bookings, users, IDs, totals, maps, verification
  results, payment results, message threads, or Admin statistics.

Before each phase, inspect `git status` and the relevant diff. Do not discard,
reset, or overwrite existing uncommitted work. Run lint and build after every
phase and report exact files changed.

## Remaining Frontend Integration Phases

Implement these in order and keep each phase independently buildable:

1. **Contract reconciliation:** align the shared API client, types, envelopes,
   errors, pagination, idempotency headers, and existing pages with OpenAPI.
2. **Listings and calendar:** Host edit/archive/photo management, address and
   approximate-map privacy, processed media states, timezone/checkout time, and
   available/blocked calendar management plus public unavailable dates.
3. **Booking lifecycle and payments:** Host decisions, cancellation, request
   expiry/completion display, booking payment summary, Stripe Checkout return
   confirmation, exact-location authorization, and stable recovery states.
4. **Messaging:** inquiry creation, inbox/thread/read/archive/close UX, REST
   `afterSequence` catch-up, Socket.IO notifications, reconnect, and deduping.
5. **Trust workflows:** Veriff identity status/session and separate private
   healthcare-evidence submission/history/withdrawal plus Admin review.
6. **Host payout and Admin operations:** Stripe Connect status/onboarding and
   Admin payment, transfer, job, requeue, reconciliation, and health views.
7. **Live integration QA:** role-based browser E2E using real local backend data
   and provider Sandbox/Test Mode; no Live Mode or real money.

Reviews, support/damage claims, external calendar synchronization, account
deletion, paid-Renter refund percentages, and Stripe Live Mode remain outside
the approved frontend scope. Do not create placeholder controls that imply
those workflows exist.

## Project Context

- Frontend app: `medicn-frontend`
- Backend app: `../medicn/apps/api`
- Backend base URL: `NEXT_PUBLIC_API_URL`, usually
  `http://localhost:4100/api/v1`
- Frontend stack: Next.js App Router, TypeScript, React, Tailwind CSS,
  shadcn/base-ui components, lucide icons.
- Backend auth: protected requests require
  `Authorization: Bearer <supabase_access_token>`.
- Backend async jobs: transactional email uses Postgres Outbox + Redis/BullMQ.
  The frontend must not talk to Redis, BullMQ, or worker scripts directly.

## Required Local Backend Setup For Verification

Before testing integration flows, the backend should be running from
`../medicn`:

```bash
npm run db:up
npm run prisma:migrate
npm run dev:api
```

Run the backend workers in separate terminals for full asynchronous flows:

```bash
npm run worker:outbox
npm run worker:email
npm run worker:media
npm run worker:maps
npm run worker:operations
```

Optional worker smoke check:

```bash
npm run smoke:email
```

The smoke command verifies the backend outbox-to-BullMQ path. Do not reproduce
that worker logic in frontend code.

## Frontend Environment Variables

Use browser-safe variables only:

```env
NEXT_PUBLIC_API_URL=http://localhost:4100/api/v1
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY=
```

Never expose backend-only keys in this repo:

- `SUPABASE_SECRET_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `GOOGLE_MAPS_SERVER_API_KEY`
- `REDIS_URL`

## API Client Requirements

Create a shared API client before building pages:

- Location: `src/lib/api.ts` or `src/lib/api/client.ts`.
- Read `NEXT_PUBLIC_API_URL`.
- Always parse the backend response envelope:

```ts
type ApiResponse<TData, TMeta = Record<string, never>> =
  | { data: TData; meta: TMeta; error: null }
  | { data: null; meta: TMeta; error: { code: string; message: string; details?: unknown } };
```

- Throw a typed error when `response.ok` is false.
- Attach `Authorization` only when a Supabase access token exists.
- Do not trust frontend-sent money amounts. Payment amounts come from backend
  `Booking` and `Listing` records.

## Component And Page Requirements

Build real app screens, not a marketing-only landing page. Keep the existing
homepage, but the first integration priority is usable marketplace flows.

### 1. Listing Search Page

Route suggestion: `src/app/search/page.tsx`

Required components:

- `ListingSearchFilters`
- `ListingResultsList`
- `ListingCard`
- `PaginationControls`
- `ListingSearchEmptyState`
- `ListingSearchErrorState`

Backend endpoint:

```http
GET /api/v1/listings
```

Supported query params:

- `location`
- `city`
- `nearbyHospital`
- `listingType`
- `category`
- `stayDuration`
- `startDate`
- `endDate`
- `minPrice`
- `maxPrice`
- `priceUnit`
- `sort`
- `page`
- `limit`
- `bounds`

Requirements:

- Store filters in URL search params so results are shareable.
- Show loading, empty, and error states.
- Use backend pagination metadata.
- Listing cards should show title, city, price, cover image if present, host
  summary, and a link to detail.
- Do not show unapproved or archived listings unless the backend explicitly
  returns them for an owner/admin flow.

### 2. Listing Detail Page

Route suggestion: `src/app/listings/[id]/page.tsx`

Required components:

- `ListingPhotoGallery`
- `ListingMapPreview`
- `ListingPlaceList`
- `AvailabilitySummary`
- `BookingRequestForm`
- `ListingDetailErrorState`

Backend endpoint:

```http
GET /api/v1/listings/:id
```

Requirements:

- Render only the backend-provided public/approximate location for ordinary
  listing visitors. Never derive a public marker from exact coordinates.
- Render `places[].mapsUrl` as safe external links.
- If a Google Maps browser key is not configured, use links instead of a map
  widget.
- Do not block the listing detail page when map data is missing.
- Booking form should require authenticated renter token before submit.

### 2A. Address, Map Privacy, And Nearby Places

MediCN uses an Airbnb-style disclosure model: the Host supplies and confirms an
accurate full address, while the public marketplace shows only the general area.
The exact check-in address is released to the authorized renter only after the
booking is paid.

Host address experience:

- Replace manual latitude/longitude fields with one accessible Google Place
  Autocomplete address control.
- After selection, show a confirmation map to the Host with the selected exact
  marker and formatted address. The Host must be able to correct the selection
  before submitting.
- Submit only fields accepted by the backend DTO, including the formatted
  address and an optional Place ID if the backend contract adds it. Do not make
  browser-provided coordinates authoritative.
- If autocomplete or Google Maps is unavailable, preserve a labeled manual
  address fallback and surface that location confirmation is pending.

Public listing experience:

- Search cards may show city and an optional backend-provided neighborhood, but
  never street number, unit number, full address, exact coordinates, or an exact
  Place ID.
- The listing detail map must show the backend-provided approximate center and
  radius/area treatment with the visible label `Approximate location`.
- Do not display the exact property pin, generate an exact Google Maps link, or
  put sensitive location values in page source, client logs, analytics, URL
  query parameters, or React props for an unauthorized viewer.
- When map data or the browser key is unavailable, show city/neighborhood text
  and a neutral map-unavailable state without breaking the listing page.

Confirmed booking experience:

- `requested`, `accepted`, and `payment_pending` booking screens continue to
  show only the general area.
- Only a booking detail response with status `paid` or `completed` may render
  backend-provided `checkInLocation` with full address, exact marker, and a
  directions link.
- `rejected` and `cancelled` bookings must not expose the exact location.
- Never infer permission from frontend state alone. Render exact location only
  when the protected backend response includes `checkInLocation`.

Nearby-place experience:

- Show backend-provided nearby hospitals/medical centers first, followed by
  public transit, pharmacies, grocery stores, and host-curated recommendations.
- Each row may show place name, category, rounded approximate distance, and a
  safe destination-only Google Maps link.
- Label straight-line distances as approximate. Show walking/driving time only
  when the backend explicitly returns provider-calculated route duration.
- Nearby-place links must not include the exact listing address or coordinates
  as a directions origin.

Google Maps key boundary:

- `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY` is browser-safe only after Google
  Cloud HTTP-referrer restrictions are configured for approved frontend origins.
- Never copy `GOOGLE_MAPS_SERVER_API_KEY` into this repository or any
  `NEXT_PUBLIC_*` variable.
- The browser key is for map rendering and Place Autocomplete. Geocoding,
  Nearby Search, route calculations, privacy transformations, and exact-location
  authorization belong to the backend.

### 3. Booking Request Flow

Required components:

- `BookingRequestForm`
- `BookingRequestSuccess`
- `BookingRequestError`
- `BookingStatusBadge`

Backend endpoint:

```http
POST /api/v1/bookings
```

Request body:

```json
{
  "listingId": "uuid",
  "startDate": "2026-07-10",
  "endDate": "2026-07-12",
  "selectedOption": "daily_short_term",
  "additionalRequests": "Optional message"
}
```

Requirements:

- Use the current Supabase access token.
- Show backend validation errors clearly.
- On success, show the booking ID and status.
- This flow triggers backend outbox email for the host. The frontend only needs
  to show booking success; worker logs verify the email path.

### 4. Renter Bookings Page

Route suggestion: `src/app/bookings/page.tsx`

Required components:

- `BookingList`
- `BookingCard`
- `BookingDetailPanel`
- `CheckoutButton`

Backend endpoints:

```http
GET /api/v1/bookings
GET /api/v1/bookings/:id
```

Requirements:

- Auth required.
- Show renter and host bookings returned by the backend.
- Show status, dates, listing title, and total amount.
- Hide or disable checkout unless status is `accepted` or `payment_pending`.

Current backend boundary:

- Host booking decisions are available through
  `PATCH /api/v1/bookings/:id/status` with `accepted` or `rejected`.
- Checkout, webhook-backed payment state, expiry, cancellation/full-refund
  orchestration, Stripe Connect, transfer/reversal state, and bounded Admin
  reconciliation contracts exist. Stripe Live Mode and marketplace legal/tax
  responsibility remain blocked; the UI must not claim production readiness or
  bank-payout completion.

### 5. Stripe Checkout And Marketplace UX

Required component:

- `CheckoutButton`

Backend endpoint:

```http
POST /api/v1/payments/checkout-session
```

Request body:

```json
{
  "bookingId": "uuid"
}
```

Requirements:

- Use backend-calculated amounts only.
- Redirect to `checkoutUrl` returned by the backend.
- Prevent repeat clicks while creating a session, but rely on backend/Stripe
  idempotency for correctness.
- A success return URL means only that the customer returned from Stripe. The
  success page must fetch the protected booking/payment status and display a
  confirming/pending state until the backend webhook reports payment.
- Never set local booking state to `paid` from a URL query parameter, Stripe
  redirect, or browser callback.
- Show an expired-payment state and let the backend decide whether a new session
  can be created. Do not reuse an expired Checkout URL.
- Show `EMAIL_NOT_VERIFIED`, `BOOKING_NOT_AVAILABLE`, and generic payment
  failures in user-readable form.
- Show refund, dispute, and cancellation states from backend data. Remove exact
  check-in location immediately when the protected backend response no longer
  includes it.

Required Host payout experience:

- Add a Host payout/settings route using the existing backend Connect contract.
- Start Stripe-hosted/embedded Connect onboarding through a protected MediCN
  endpoint and redirect only to backend-approved Stripe URLs.
- Show backend-provided onboarding, requirements-due, charges-enabled, and
  payouts-enabled status. Do not infer readiness from returning to the frontend.
- Do not build bank-account, government-ID, taxpayer-ID, or payout credential
  fields in MediCN. Those belong in Stripe's secured onboarding components.
- Hosts who are not payout-ready may draft/manage listings, but the UI must
  honestly enforce the backend's publish/paid-booking policy.

### 5A. Veriff Identity Verification

Required route/components using the existing backend contracts:

- `/verification`
- `IdentityVerificationStatus`
- `StartIdentityVerificationButton`
- `VerificationPendingState`
- `VerificationRejectedState`

Requirements:

- Request a Veriff session from the protected MediCN backend, then open the
  provider-hosted verification flow. Never call Veriff with a secret from the
  browser.
- Treat the provider return/callback as `submitted` only. Refresh the MediCN
  current-user/verification endpoint until the backend webhook reports the
  authoritative status.
- Surface `not_started`, `pending`, `approved`, `rejected`, and `expired`
  honestly, including retry/help actions allowed by the backend.
- Gate Host publishing and Renter booking/payment controls using backend error
  codes and verification status, while keeping public browsing available.
- Identity approval must not display a healthcare-credential badge. Healthcare
  role/affiliation verification is a separate workflow and status.
- Never upload government IDs or selfies through profile/listing upload APIs,
  store them in browser persistence, log them, or render raw Veriff payloads.

### 6. Host Listing Creation And Photo Upload

Route suggestion: `src/app/host/listings/new/page.tsx`

Required components:

- `ListingCreateForm`
- `AvailabilityEditor`
- `PlaceFields`
- `PhotoUploadControl`
- `HostListingSuccess`

Backend endpoints:

```http
POST /api/v1/listings
POST /api/v1/uploads/presigned-url
POST /api/v1/listings/:id/photos
```

Create listing request fields:

- `title`
- `description`
- `city`
- `address`
- `priceCents`
- `priceUnit`
- `listingType`
- `category`
- `stayDurations`
- `proximityTags`
- `specialFeatures`
- `availability`
- `neighborhoodPerks`
- `localRecommendations`

The UI must not ask Hosts to type `latitude` or `longitude`. The backend may
continue accepting these fields for compatibility, but new frontend submissions
must use the selected address/Place ID contract and let the backend resolve the
authoritative coordinates.

Photo upload flow:

1. Create or select the listing.
2. Call `POST /uploads/presigned-url` with `purpose`, `listingId`, `fileName`,
   and `contentType`.
3. Upload the file to the returned signed URL using the storage provider flow.
4. Call `POST /listings/:id/photos` with `storagePath`.

Never accept arbitrary external image URLs as listing photos.

Media processing requirements:

- A successful storage PUT means `uploaded`, not publicly ready. Display
  processing state until the backend returns a sanitized `ready` photo.
- Show rejected/processing-failed states and allow a new upload without leaving
  broken gallery entries.
- Render only backend-issued ready derivatives. Do not use the local object URL
  as if it were a persisted listing photo.
- Client MIME and 5 MB checks are usability guards only; never claim they are
  security validation. The backend processing pipeline is authoritative.
- Profile avatars follow the same processing contract. Verification documents
  must never use listing/profile photo controls.

### 7. Integration QA Panel

Route suggestion: `src/app/dev/integration/page.tsx`

This page may be temporary and should be hidden from production nav unless a
feature flag is enabled.

Required checks:

- Show backend health status.
- Let a signed-in user call `GET /auth/me`.
- Let QA create a booking against a known listing.
- Show the returned booking ID and status.
- Explain that email verification is confirmed through backend worker logs, not
  by browser access to Redis/BullMQ.

Do not expose secrets or raw access tokens in screenshots or persistent logs.

## Authentication Requirements

Protected flows require Supabase Auth:

- host listing creation
- photo upload
- booking request
- booking list/detail
- checkout session
- identity-verification session
- Stripe Connect Host onboarding

If Supabase auth is not wired yet, use a clearly marked local-only token input
for QA pages only. Do not ship manual token input in production UI.

## Design And Accessibility Requirements

- Follow existing project visual language and shadcn/base-ui patterns.
- Use lucide icons for icon buttons when available.
- Keep operational pages dense, clear, and task-focused.
- Every form needs labels, validation messages, loading state, success state,
  and error state.
- All interactive controls must be keyboard accessible.
- Test responsive layouts at 320px, 768px, 1024px, and 1440px.
- Do not add explanatory feature text inside the app just to describe how the
  code works.

## Verification Checklist

Before marking frontend integration complete:

- `npm run lint` passes in `medicn-frontend`.
- `npm run build` passes in `medicn-frontend`.
- Search page loads public listings from backend.
- Listing detail renders places/map links without crashing when map data is
  missing.
- Public listing/search responses and rendered page source contain no full
  address, unit number, exact coordinates, or exact-location Place ID.
- Host address autocomplete can select and confirm an address without manual
  latitude/longitude entry.
- Public listing detail labels its map as approximate and shows nearby places
  without leaking the property as a directions origin.
- Requested/accepted/payment-pending bookings do not render an exact address;
  a paid/completed booking renders exact location only when returned by the
  protected backend response.
- Authenticated renter can create a booking.
- Booking creation produces backend worker/outbox logs when `worker:email` is
  running.
- Checkout button is disabled for `requested` bookings.
- Checkout redirects only for a backend-accepted or payment-pending booking.
- A Stripe return page never claims payment success until a protected backend
  response reports the completed webhook-driven state.
- Repeated checkout clicks do not create visible duplicate attempts, and expired
  sessions recover through a backend-authorized new attempt.
- Refunded, disputed, rejected, and cancelled reservations do not display exact
  check-in location.
- Veriff return/callback pages show submitted/pending until the backend reports
  an authoritative decision; no raw identity data appears in UI/logs/storage.
- Host payout setup uses Stripe-hosted/embedded onboarding and displays only
  backend-provided readiness status.
- Host can create a listing and attach a backend-issued photo storage path.
- Uploaded listing/profile media is not rendered as durable public media until
  the backend reports a sanitized ready derivative.

## Do Not Do

- Do not call Redis, BullMQ, or worker commands from browser code.
- Do not expose server-only secrets in `NEXT_PUBLIC_*`.
- Do not send payment amounts from the frontend.
- Do not collect bank account, card, tax ID, government ID, or Veriff secret
  values in ordinary MediCN forms.
- Do not mark payment successful from Stripe redirect/query parameters or mark
  identity approved from a Veriff browser callback.
- Do not upload identity documents to the public listing/profile bucket.
- Do not mark maps/payment/email as complete without backend smoke evidence.
- Do not build calendar sync unless the project lead explicitly chooses that
  Week 7 path.
