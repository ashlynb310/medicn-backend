# CLAUDE.md

Frontend agents must follow `AGENTS.md` first. This file adds concrete
requirements for integrating the current MediCN backend work into the official
frontend and verifying Week 6 backend flows.

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

For Week 6 email/outbox verification, run this in a second backend terminal:

```bash
npm run worker:email
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
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
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

- Render `latitude` and `longitude` when present.
- Render `places[].mapsUrl` as safe external links.
- If a Google Maps browser key is not configured, use links instead of a map
  widget.
- Do not block the listing detail page when map data is missing.
- Booking form should require authenticated renter token before submit.

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

Important backend limitation:

- The backend can create booking requests, but there is not yet a host accept
  endpoint in this repo. Checkout requires `accepted` or `payment_pending`.
  Do not claim payment is end-to-end complete until a host acceptance flow or
  safe test fixture exists.

### 5. Stripe Checkout Prep

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
- Add success/cancel return pages only after routes are agreed with backend.
- Show `EMAIL_NOT_VERIFIED`, `BOOKING_NOT_AVAILABLE`, and generic payment
  failures in user-readable form.

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
- `latitude`
- `longitude`
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

Photo upload flow:

1. Create or select the listing.
2. Call `POST /uploads/presigned-url` with `purpose`, `listingId`, `fileName`,
   and `contentType`.
3. Upload the file to the returned signed URL using the storage provider flow.
4. Call `POST /listings/:id/photos` with `storagePath`.

Never accept arbitrary external image URLs as listing photos.

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
- Authenticated renter can create a booking.
- Booking creation produces backend worker/outbox logs when `worker:email` is
  running.
- Checkout button is disabled for `requested` bookings.
- Checkout redirects only for a backend-accepted or payment-pending booking.
- Host can create a listing and attach a backend-issued photo storage path.

## Do Not Do

- Do not call Redis, BullMQ, or worker commands from browser code.
- Do not expose server-only secrets in `NEXT_PUBLIC_*`.
- Do not send payment amounts from the frontend.
- Do not mark maps/payment/email as complete without backend smoke evidence.
- Do not build calendar sync unless the project lead explicitly chooses that
  Week 7 path.
