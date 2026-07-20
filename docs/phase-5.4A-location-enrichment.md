# Phase 5.4A location privacy and enrichment specification

## Objective

Add a provider-neutral, production-oriented location pipeline for Host-entered listing addresses while preserving Phase 4.8A privacy. Exact addresses and coordinates remain private, public map centers are stable server-generated approximations, paid renters receive an immutable payment-time check-in snapshot, and nearby/route enrichment occurs durably outside public GET requests.

## Assumptions and decisions

- Google adapters use Geocoding API v4, Places API (New) v1 Nearby Search, and Routes API v2 Compute Route Matrix. Legacy Find Place and legacy Distance Matrix are retired.
- `placeId` is an untrusted hint and is always resolved through Geocoding v4.
- Maps-disabled or provider-outage listing writes remain possible as pending/failed location drafts; approval requires `verified` location state.
- Material location change means the normalized address/city fingerprint changes. Cosmetic whitespace changes do not create a new version.
- Active future `accepted`, `payment_pending`, or `paid` bookings block a material change.
- Stable approximation uses HMAC-SHA256-derived bearing/distance from listing ID plus address fingerprint. It changes only when the address version changes. The configured radius remains 500 metres and displacement is 300–450 metres.
- Nearby results are stored separately from Host-curated `ListingPlace` rows. Google-derived content expires no later than 30 days; route estimates expire after 7 days.
- Public straight-line and route computations originate at the approximate public center. Exact coordinates are used only for private address verification and booking snapshots.
- Google-derived coordinate retention and long-lived booking snapshots require legal/terms review before production. The implementation stores provenance and expiry so refresh/deletion policy can be enforced; it does not claim terms approval.

## Provider contract

`MapsProvider` supports:

- `geocodeAddress({ address, placeId? }, signal)`
- `searchNearby({ center, includedTypes, radiusMeters, maxResults }, signal)`
- `computeRouteMatrix({ origin, destinations, travelMode }, signal)`

Responses are explicit allowlisted types. Provider errors map to stable categories: disabled, timeout/unavailable, invalid, ambiguous, quota/rate limited. No raw response, exact address, coordinates, or server key is logged.

Google request policy:

- Geocoding v4 address/place endpoints with a minimal field mask covering formatted address, place ID, location, granularity, and result types needed for quality classification.
- Places New `POST https://places.googleapis.com/v1/places:searchNearby` with `X-Goog-FieldMask: places.id,places.displayName,places.googleMapsUri,places.location,places.types`.
- Routes v2 `POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix` with `X-Goog-FieldMask: originIndex,destinationIndex,status,condition,distanceMeters,duration`; no traffic-aware preference.
- Abortable requests bounded by `MAPS_PROVIDER_TIMEOUT_MS`; response bodies are size-limited and parsed by allowlists.

## Data model

- `ListingLocation`: one durable authoritative location state per listing, address version, Host input/city, formatted address, provider/place ID, exact coordinates, status/precision/fingerprint, geocode/enrichment attempts and timestamps, failure category, cache expiry, and processing claim. Compatibility public coordinates remain on `Listing`.
- `NearbyPlace`: automatic provider-derived places with category, provider ID, allowlisted display/URI data, destination coordinate cache, Haversine distance, optional route values/mode, rank, provenance and expiry. Unique per location version/category/provider place ID.
- `BookingLocationSnapshot`: one immutable snapshot per booking, created inside the payment-success transaction from a verified listing location.
- Existing `Listing.address`, exact/public coordinates remain populated for compatibility. Existing records are classified `stale` when exact coordinates exist and `not_started` otherwise; they are not falsely labeled provider-verified.

## Contracts and privacy

Create/update accepts human-readable `address` and optional `placeId`. `latitude`, `longitude`, `publicLatitude`, and `publicLongitude` are rejected at validation boundaries. Normalization collapses whitespace. Verified responses update exact compatibility fields and stable approximate fields; failures preserve prior verified data.

Public listings expose only `publicLocation` and automatic `nearbyPlaces`. Public nearby distance is rounded by `MAPS_PUBLIC_DISTANCE_ROUNDING_METERS`. Exact listing place IDs, address, exact coordinates, route origin, and directions URLs are never public.

Owner/Admin detail additionally exposes `exactLocation`, `locationStatus`, and `nearbyEnrichmentStatus`. Booking lists omit `checkInLocation`; protected detail returns a snapshot only for Host/Admin or a currently paid/completed renter without refund/dispute revocation.

## Durable jobs and recovery

- Outbox event `enrich_listing_location` uses idempotency key `maps-enrich:<listingId>:<addressVersion>`.
- BullMQ queue `maps` uses the outbox row ID as job ID.
- Database advisory lock and conditional address-version update ensure one claim and prevent stale overwrite.
- Failed provider work returns to durable retryable state without erasing verified data.
- Commands: `worker:maps`, `maps:retry`, `maps:refresh`.

## Threat model

- Spoofing/tampering: browser coordinates and place IDs are untrusted; provider resolution and database ownership checks are authoritative.
- Information disclosure: public serializers allowlist approximate fields; logs and outbox payloads contain only listing ID/version.
- Denial of service/cost abuse: disabled-by-default provider, bounded timeout/body size/concurrency/result counts, cache hits, no provider GET calls, stable idempotency.
- Race/stale writes: advisory locks and address-version predicates.
- Reservation fraud: immutable payment-time snapshot and active-booking address-change block.

## Testing strategy

- Pure unit tests for normalization, fingerprinting, stable displacement, Haversine/antimeridian, and rounding.
- Adapter tests mock `fetch` and prove endpoints, FieldMasks, type mappings, timeouts, partial route results and secret-safe failures.
- Service tests cover location status transitions, outage preservation, booking block, stale versions, DTO privacy, cache behavior, curated-place preservation, and no public-GET calls.
- Gated PostgreSQL tests cover concurrent enrichment claims and snapshot persistence across listing mutation; payment-transaction atomicity is covered by the payment service unit test.

## Commands

```text
npm run prisma:generate
npm run build -w apps/api
npm run typecheck -w apps/api
npm run lint -w apps/api
npm run test -w apps/api -- --runInBand
RUN_DATABASE_INTEGRATION_TESTS=true npm run test -w apps/api -- --runInBand
```

## Task breakdown

- [x] Config/provider contracts and geographic utilities; focused unit tests pass.
- [x] Google adapters with allowlisted parsing, explicit FieldMasks and timeouts; mocked HTTP tests pass.
- [x] Prisma enums/models and data-preserving migrations; client generated and migrations applied locally.
- [x] Listing create/update resolution, versioning, booking block and approval gate; service tests pass.
- [x] Nearby/route processor, caches, DTO privacy and stale-job protection; unit tests pass.
- [x] Maps BullMQ/outbox worker and recovery commands; routing and outbox idempotency are covered.
- [x] Payment-time booking snapshot and protected-detail serialization; payment/booking tests pass.
- [x] Gated concurrency/snapshot tests, operations documentation, migrations and full verification pass locally.

## Boundaries

- Always: preserve exact/public/check-in privacy, validate external responses, use persisted paths/IDs, mock Google in tests.
- Ask first: live Google calls, new paid provider enablement, changing the API envelope.
- Never: frontend changes, browser key/backend mixing, exact public markers, provider payload persistence, provider calls during public GET, Veriff/media changes.
