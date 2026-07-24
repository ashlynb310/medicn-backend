# ADR-004: Select Messaging MVP for the Week 7 branch

- Date: 2026-07-19
- Status: Accepted

## Context

Week 7 permits either a user-to-user messaging MVP or calendar-sync exploration. Messaging closes the renter discovery-to-contact loop and is prioritized in Product Planning. `Inquiry` and `Message` already exist in the Week 2 ERD and current Prisma schema. External calendar synchronization is a future-roadmap item; local availability remains part of booking lifecycle work.

## Source requirements

- [Product Planning](../../../_extracted_export/Product%20Planning%20e296cd360a844ace803814a81eb2a1ca.md): Messaging / Inquiry is the connection-layer bottleneck; calendar sync is post-MVP.
- [Week 7 task](../../../_extracted_export/Build%20user-to-user%20messaging%20MVP%20or%20calendar-sync%20%202c6c4e7664fd4a69b0f66c3d996bc907.md): choose messaging or calendar exploration.
- [Week 2 API design](../../../MediCN-Weekly-Report/Week2/API-Design.md): inquiry create/list/detail and message-send endpoints, participant/Admin access.
- [Week 2 ERD](../../../MediCN-Weekly-Report/Week2/ERD-Database-Backend.md): `Inquiry` and `Message` ownership and access rules.
- [Backend gap audit](../backend-final-gap-audit.md): messaging is the chosen next connection-layer workflow once the branch is decided.

## Decision

Implement a first-party Messaging MVP in Phase 5.7A. Its boundary is:

- A renter opens an inquiry against an approved, non-archived listing and supplies the first message.
- The inquiry renter, the listing Host captured on the inquiry, and an Admin are the only readers.
- The renter and Host may send messages while the inquiry is open. Admin access is for support/moderation; Admin-authored messages must be visibly identified and audited.
- Provide participant-scoped conversation list, detail, unread count, read cursor, close, and archive operations.
- `closed` is a thread-wide state. It prevents participant messages but preserves read access. Reopening is not part of the MVP; Admin support may create an audited correction if later approved.
- Archive is per participant, not a global thread state. Archiving hides a conversation from that participant's default list without deleting it or affecting the other participant. A new authorized message restores it to the recipient's active list.
- Use a per-inquiry/per-user read cursor. The existing single `Message.readAt` field cannot honestly represent both participants or Admin reads and must not be the authoritative unread model.
- Queue minimal durable email notification through the existing transactional Outbox. Queue payloads and logs contain inquiry/message IDs and template metadata, not message body, phone number, email address, identity data, or listing address.
- DTOs never expose participant email or phone fields. Message validation rejects obvious email addresses and phone-number patterns with a stable `CONTACT_INFORMATION_NOT_ALLOWED` error; this is a product guard, not a promise of perfect automated content detection.
- No attachments, realtime WebSocket requirement, external chat provider, typing indicators, reactions, group threads, or message editing/deletion.

## Alternatives

1. **External calendar synchronization now:** rejected for Week 7 because Product Planning labels it future roadmap and it does not close the contact loop.
2. **External chat provider:** rejected for the MVP because current first-party models and Outbox are sufficient and a provider adds privacy, retention, and cost decisions.
3. **Email relay without stored messages:** rejected because it weakens participant authorization, unread state, support auditability, and continuity.

## Consequences

- Phase 5.7A is unblocked.
- A participant-state/read-cursor model or equivalent schema change is required; global `Inquiry.status=archived` must not be used for a user-local archive.
- Email notification failure does not roll back a committed message because the Outbox is the durability boundary.
- Content moderation remains intentionally narrow; the MVP needs reporting/support follow-up before public launch.

## Backend invariants

- `Inquiry.hostId` equals the listing Host at creation and is not browser supplied.
- Only the renter, captured Host, or Admin can read an inquiry; only enabled renter/Host participants can send.
- Message sender, inquiry, participant authorization, message insert, read-state effects, and Outbox event are handled transactionally where applicable.
- Empty/whitespace-only and over-limit bodies are rejected. Adopt 4,000 Unicode code points as the MVP message limit.
- Lists and unread counts are actor-scoped, paginated, and do not reveal whether an unrelated inquiry exists.
- Closing/archiving never deletes messages or changes booking/payment state.

## API implications

Retain the Week 2 routes and add participant-state operations:

- `POST /api/v1/listings/:id/inquiries`
- `GET /api/v1/inquiries`
- `GET /api/v1/inquiries/:id`
- `POST /api/v1/inquiries/:id/messages`
- `POST /api/v1/inquiries/:id/read`
- `POST /api/v1/inquiries/:id/close`
- `POST /api/v1/inquiries/:id/archive`

All protected routes use the shared disabled-account boundary and standard response envelope. Unauthorized private IDs should use the project's eventual opaque-resource policy consistently.

## Data/privacy implications

- Message bodies are private user content; they must not enter email payloads, metrics, structured logs, or public DTOs.
- Retention and deletion periods remain subject to ADR-015 and the unapproved Privacy Policy.
- Admin reads and moderation actions require bounded audit records.
- No healthcare credential, identity result, exact listing location, phone number, or email address is copied into message metadata.

## Tests required

- Renter creation success; wrong role, unverified/disabled/ineligible actor, non-public listing, self-inquiry, and Host mismatch failures.
- Renter/Host/Admin read and send authorization; unrelated-user opaque failure.
- Message length, empty body, contact-information guard, pagination, stable ordering, and no sensitive DTO fields.
- Read cursors and unread counts under concurrent messages and duplicate read calls.
- Per-user archive, thread-wide close, no send after close, and new-message unarchive behavior.
- Message and Outbox atomicity, idempotent notification keys, and payload/log redaction.
- PostgreSQL concurrency tests for duplicate inquiry creation policy and cursor monotonicity.

## Unresolved questions

- Whether one open inquiry per renter/listing is enforced or multiple stays may have separate inquiries.
- Whether participants may report/block users in the first public release.
- Whether the obvious-contact-information guard should be strict rejection or moderation review after beta feedback.
- Final retention period and legal-access procedure for message content.

## Approval needed

No additional owner decision is needed to start the bounded MVP. Product owner approval is still needed for the unresolved abuse, duplicate-thread, and retention policies before public launch.

## Status

**Accepted.** Messaging, not external calendar synchronization, is the current Week 7 implementation branch.
