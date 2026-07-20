# ADR-014: Block production Maps use until retention, provider rights, and attribution are approved

- Date: 2026-07-19
- Status: Blocked

## Context

MediCN needs durable private addresses for listing management and paid check-in fulfillment, plus cached nearby/route enrichment. Host-entered address text is first-party input, but formatted addresses, coordinates, place data, and routes returned by Google are provider content subject to contract, caching, display, regional, and attribution requirements.

## Source requirements

- [AGENTS.md](../../AGENTS.md): exact/public location separation, provider provenance/TTL, safe degradation, and server-only keys.
- [Phase 5.4A location documentation](../phase-5.4A-location-enrichment.md): implementation intentionally does not claim retention rights.
- [Legal & Compliance](../../../_extracted_export/Legal%20%26%20Compliance%20cf2ddd28f07146dabd3e079984281942.md): privacy policy, processor disclosure, and retention are unapproved.
- [Google Geocoding policies](https://developers.google.com/maps/documentation/geocoding/policies) and [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies): storage is generally restricted, Place IDs are an exception, and attribution/display rules apply.
- [Google Place ID guidance](https://developers.google.com/maps/documentation/places/web-service/place-id): Place IDs may be retained and should be refreshed when stale under current guidance.

## Decision

- Host-entered address text is first-party MediCN input and may be retained under MediCN's approved privacy/retention policy. It remains private and never becomes public merely because MediCN owns the input.
- Google-derived formatted address, coordinates, precision, nearby-place content, distances/routes, and derivative public centers remain subject to the applicable account agreement and product-specific policies. Durable/cached use is not approved by this ADR.
- Current Google documentation treats Place IDs as exempt from general caching restrictions; they may generally be retained under the applicable agreement and should be refreshed according to current guidance. Account/region/contract review is still required before relying on that exception.
- `MAPS_ENABLED` must remain false for real production-provider use until the project records: billing entity/region, applicable agreement, permitted stored fields, TTL/refresh/delete policy, required attribution, public Terms/Privacy links, and legal/product approval.
- Google-derived data displayed with or without a Google map must carry the applicable Google/third-party attribution. UI implementation must follow the current product-specific policy, not a copied static assumption.
- Paid `BookingLocationSnapshot` needs a durable source. Before enabling Google, confirm that the chosen agreement permits this use; otherwise derive fulfillment location from first-party Host input and/or select a commercial geocoder contract that expressly permits required durable storage.
- Alternatives include a commercial geocoder with durable-storage rights, self-hosted/licensed geodata, or approved Google terms/configuration.

## Alternatives

1. **Assume all geocoding output is first-party because the Host entered the address:** rejected; provider enrichment/output has separate contractual provenance.
2. **Retain only Place ID and re-fetch all display data:** viable only after availability, latency, attribution, paid-booking fulfillment, and outage behavior are approved.
3. **Commercial durable-storage geocoder:** viable and should be compared on rights, quality, privacy, coverage, cost, and attribution.
4. **Disable enrichment permanently:** privacy-safe but reduces search/nearby experience; first-party address fulfillment still needs geocoding/confirmation design.

## Consequences

- Existing provider abstraction, safe degradation, provenance, and TTL fields remain useful, but production Google calls are blocked.
- A provider/legal decision may require deleting/refetching Google-derived fields or changing the fulfillment-location source before launch.
- Public attribution is a frontend requirement later; this phase does not modify frontend code.

## Backend invariants

- Host input and provider-derived fields have explicit, separate provenance.
- Exact address/coordinates remain restricted to Host/Admin and eligible booking fulfillment.
- Public location remains displaced/coarsened and cannot reconstruct exact location.
- Provider caches obey approved TTL/refresh/deletion; disabling provider calls does not delete first-party Host input.
- Server key never enters browser responses, logs, or public configuration.
- Nearby/route output never leaks exact origin through coordinates or directions URLs.

## API implications

- Existing safe public/private serializers remain.
- Provider-derived DTO fields need attribution/provenance metadata sufficient for compliant display, without exposing secrets or exact origin.
- Provider-disabled state degrades to Host input/city and safe approximation rather than exposing stale/unapproved data.
- No API promises indefinite availability of provider content except fields explicitly approved under the final agreement.

## Data/privacy implications

- Exact address and coordinates are high-risk location data requiring purpose limitation, access controls, retention, correction, and deletion policy.
- Google or an alternative provider must be named as a processor/recipient in the approved Privacy Policy as applicable.
- Public Terms/Privacy and attribution obligations must be satisfied before provider-backed public display.
- Regional terms, especially EEA-specific terms for an EEA billing account, must be checked against the actual account.

## Tests required

- Provider-disabled no-network behavior and safe city/approximation fallback.
- Provenance/TTL/refresh/delete behavior for every approved provider field.
- Public/private serializer privacy and attribution metadata.
- Exact-origin leakage tests for nearby/routes/maps URLs.
- Place ID refresh/obsolete behavior if Google is approved.
- Contract-approved retention fixtures and cleanup without deleting first-party input or immutable authorized booking records improperly.

## Unresolved questions

- Actual Google billing entity/region, negotiated terms, and enabled products.
- Which fields may be stored, for how long, and whether booking snapshots are permitted.
- Required frontend attribution placement and public Terms/Privacy language.
- Whether an alternative provider provides better durable-storage rights.
- Retention/deletion treatment when a listing address changes or account deletion is requested.

## Approval needed

Product owner, privacy/legal reviewer, and provider/account owner must approve the provider, agreement, field-level retention matrix, attribution plan, and booking-snapshot rights.

## Status

**Blocked.** Real production-provider use remains disabled until rights and operating policy are recorded; this ADR is not legal advice.
