# Phase 5.7A inquiry and realtime messaging MVP

Date: 2026-07-19  
Scope: backend-only inquiry, durable message state, Outbox email notification,
and Socket.IO notification delivery. This phase does not change
`medicn-frontend`, booking/payment behavior, calendar sync, or Phase 5.7B.

## Objective and boundaries

A verified Renter can contact the captured Host of an approved, non-archived
listing without first creating a booking. PostgreSQL is authoritative. REST is
the only write path; WebSocket events are disposable notifications that clients
reconcile against REST.

Always enforced:

- `hostId` is copied from the listing and is never request input.
- A Renter cannot inquire on their own listing.
- One open inquiry per Renter/listing is enforced by a PostgreSQL partial unique
  index, including concurrent requests.
- Only the captured Renter, captured Host, and Admin can read. Only enabled
  captured participants and Admin can send while open.
- Admin-authored messages carry an immutable `senderRole=admin` marker and create
  an `AdminAction` audit row without copying the message body.
- Close is thread-wide, idempotent, permanent in this MVP, and makes the thread
  read-only. Archive is per user.
- A new message clears `archivedAt` only for its recipient or recipients.
- No message body enters structured logs, realtime events, or Outbox payloads.

Deferred: reporting/blocking, attachments, typing, presence, reactions, editing,
deletion, search, group chat, SMS, push, calendar sync, and automatic deletion.
Retention remains unresolved and no retention job is introduced.

## Durable schema and migration

Migration: `prisma/migrations/20260727000000_add_messaging_mvp/migration.sql`.

- `Inquiry.lastSequence`: next ordering boundary protected by an inquiry row
  lock.
- `Inquiry.lastMessageAt`: indexed conversation ordering metadata.
- `Inquiry.closedAt` and `closedById`: permanent thread-wide close state.
- `Message.sequence`: non-null inquiry-scoped sequence with unique
  `(inquiryId, sequence)`.
- `Message.senderRole`: immutable `renter|host|admin` presentation/audit marker.
- `InquiryParticipantState`: unique `(inquiryId,userId)`, role, monotonic
  `lastReadSequence`, optional `lastReadAt`, and per-user `archivedAt`.
- Partial unique index
  `Inquiry_one_open_per_renter_listing_key(listingId,renterId) WHERE closedAt IS NULL`.
- Renter/Host conversation-order indexes and participant-state lookup indexes.
- Database checks require positive message sequences and non-negative inquiry/read
  cursors. The migration stops with an explicit preflight error if legacy data
  contains duplicate open Renter/listing pairs; it does not silently discard or
  merge private conversations.

The migration assigns historical message sequences by `(createdAt,id)`, derives
historical sender roles from captured inquiry parties, seeds Renter/Host state,
copies a legacy global `archived` state into both users' local archive state, and
backfills last-message metadata. `InquiryStatus.archived` and `Message.readAt`
remain compatibility fields but are not authoritative.

## Authorization matrix

| Operation | Renter | Captured Host | Admin | Unrelated user |
| --- | --- | --- | --- | --- |
| Create from listing | verified Renter only | no | no | no |
| List/detail | own inquiries | own inquiries | all | opaque `NOT_FOUND` for detail |
| Send while open | captured, enabled | captured, enabled | allowed and audited | opaque `NOT_FOUND` |
| Mark read | self state | self state | self Admin state | opaque `NOT_FOUND` |
| Close | allowed | allowed | allowed | opaque `NOT_FOUND` |
| Archive/unarchive | self state only | self state only | self state only | opaque `NOT_FOUND` |
| Subscribe realtime room | allowed | allowed | allowed | opaque `NOT_FOUND` |

Shared Supabase bearer verification and `ACCOUNT_DISABLED` enforcement apply to
HTTP and Socket.IO. Inquiry IDs never reveal existence to unrelated users.

## REST contracts

All routes use `/api/v1`, the standard `{data,meta,error}` envelope, and Supabase
bearer authentication.

### Create

`POST /listings/:listingId/inquiries`

Request: `{ "message": "1-4000 Unicode code points" }`.

Response data contains the safe inquiry detail and first message. Creation of the
inquiry, two participant states, first message, and ID-only notification Outbox
row is atomic. Duplicate open creation returns `INQUIRY_ALREADY_OPEN`.

### List

`GET /inquiries?status=open|closed&archived=true|false&page=1&limit=20`

The default is unarchived conversations. Results are ordered by
`lastMessageAt DESC, id DESC` and contain safe listing/participant summaries,
bounded last-message preview, `unreadCount`, `lastSequence`, `lastMessageAt`, and
the actor's archive state. Email, phone, exact location, coordinates, provider
identity, and healthcare fields are absent.

### Detail and catch-up

`GET /inquiries/:id?afterSequence=0&limit=50`

Messages are returned in ascending `sequence` order. `nextCursor` is the final
returned sequence and `hasMore` indicates another REST page. Clients use this
route after reconnect, beginning at their last observed sequence.

### Send

`POST /inquiries/:id/messages`

Request: `{ "message": "1-4000 Unicode code points" }`.

The transaction row-locks the inquiry, rejects a closed thread, allocates the
next sequence, inserts the message, updates last-message metadata, unarchives
the recipient, adds any Admin audit, and writes one deterministic ID-only email
Outbox event per recipient. Realtime emit happens only after commit and failure
does not change the REST result.

### Read

`POST /inquiries/:id/read`

Request: `{ "sequence": 17 }`.

The cursor is clamped to the committed `lastSequence`, moved with PostgreSQL
`GREATEST`, and is therefore bounded, monotonic, idempotent, and concurrency-safe.

### Close

`POST /inquiries/:id/close`

No body. Repeated calls return the same close state. Sending afterward returns
`INQUIRY_CLOSED`; reopening is not provided.

### Archive

`POST /inquiries/:id/archive`

Request: `{ "archived": true|false }`. Only the actor's state changes.

## Content rules

The server trims surrounding whitespace, rejects an empty result, counts Unicode
code points (not UTF-16 code units), and rejects more than 4,000. Obvious email
addresses and international/North-American phone formats return
`CONTACT_INFORMATION_NOT_ALLOWED`. Content is never silently rewritten.

## Realtime contract

Namespace: `/messaging`.

Handshake authentication uses `auth.accessToken`. Query-string tokens are
rejected. The server verifies the token with Supabase, loads the synced profile,
enforces `ACCOUNT_DISABLED`, extracts the verified token expiry, and disconnects
the socket at expiry. Clients reconnect with a refreshed token.

Client events:

- `inquiry.subscribe {inquiryId}`: joins only after participant/Admin check.
- `inquiry.unsubscribe {inquiryId}`: leaves the inquiry room.
- `heartbeat`: acknowledgement-only liveness event; Socket.IO ping/pong also runs.

Server events contain opaque IDs, sequences, statuses, and ISO timestamps only:

- `message.created {eventId,inquiryId,messageId,sequence,createdAt}`
- `inquiry.updated {eventId,inquiryId,status,lastSequence,lastMessageAt,updatedAt}`
- `inquiry.closed {eventId,inquiryId,status,closedAt}`
- `unread.changed {eventId,inquiryId,userId,lastReadSequence?,unreadCount?,updatedAt}`

No event contains a body, email, phone, address, coordinates, Supabase ID,
identity result, or healthcare data. Deterministic `eventId` values make duplicate
delivery harmless. Each authenticated socket joins `user:<internal-user-id>`;
authorized subscriptions join `inquiry:<inquiry-id>`.

Per-user and global connection limits are enforced. Invalid/missing/expired auth
is rejected, expiry timers are cleared on disconnect, errors are sanitized, and
shutdown closes Socket.IO plus Redis clients.

## Redis topology and recovery

Each API instance uses a Socket.IO Redis adapter with one publish and one
subscribe client derived from `REDIS_URL` and the messaging key prefix. Redis
propagates opaque Socket.IO packets between API instances; it never stores the
authoritative conversation state. If Redis is absent or unavailable, local
Socket.IO may degrade and REST writes still commit. Clients recover as follows:

1. Persist the largest processed sequence per inquiry.
2. Reconnect using a refreshed Supabase access token.
3. Re-subscribe to visible inquiry rooms.
4. Call detail with `afterSequence=<last processed sequence>` until `hasMore=false`.
5. Apply messages by `(inquiryId,sequence)` and ignore duplicate event IDs or
   already-applied sequences.

Reverse proxies must support HTTP/1.1 WebSocket upgrade, forward `Upgrade` and
`Connection` headers, keep idle connections beyond the configured ping interval,
and use sticky sessions only if long-polling transport remains enabled. WebSocket
transport is preferred; Redis handles cross-instance rooms.

## Outbox and email

Each message transaction writes `send_messaging_notification_email` with only
`inquiryId`, `messageId`, `recipientUserId`, and template metadata. The key is
`messaging-email:<messageId>:<recipientUserId>`. The existing Outbox publisher
routes it to the email BullMQ queue. The email worker reloads the inquiry/message,
confirms the recipient is a captured party, resolves the current trusted email
address and safe listing title, and then invokes the existing provider-agnostic
email adapter. Email failure never rolls back a committed message. Message bodies
are not used in email content.

## Stable errors

`INQUIRY_NOT_AVAILABLE`, `INQUIRY_ALREADY_OPEN`, `INQUIRY_CLOSED`,
`CONTACT_INFORMATION_NOT_ALLOWED`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_DISABLED`,
`FORBIDDEN`, `NOT_FOUND`, and `VALIDATION_ERROR` use the shared API envelope.

## Verification and production boundary

Normal tests use mocks/fakes and require no Redis or providers. PostgreSQL and
two-instance Redis/Socket.IO tests are gated by the repository integration flags.
Provider calls are not part of this phase. Passing this phase does not establish
production readiness; managed Redis, proxy, capacity, abuse/reporting, retention,
and deployment drills remain outstanding.

Verification on 2026-07-19:

- `npm run prisma:generate`: passed (Prisma Client 7.8.0).
- `npx prisma validate`: passed.
- `npm run typecheck -w apps/api`: passed.
- `npm run lint -w apps/api`: passed.
- `npm run build -w apps/api`: passed.
- `npm run test -w apps/api -- --runInBand`: 35 suites / 272 tests passed;
  9 gated suites / 16 tests skipped.
- `npx prisma migrate deploy`: passed; no pending migrations remained.
- `npx prisma migrate status`: 17 migrations found; database schema is up to
  date, including `20260727000000_add_messaging_mvp`.
- PostgreSQL messaging integration: 1 suite / 4 tests passed with
  `RUN_DATABASE_INTEGRATION_TESTS=true`.
- Redis/Socket.IO messaging integration: 1 suite / 1 test passed with
  `RUN_REDIS_INTEGRATION_TESTS=true`, using two real
  `MessagingSocketAdapter` instances and `MessagingRealtimeService`.
- Complete combined gated API run: 44 suites / 288 tests passed with both
  integration flags enabled; no suites or tests were skipped.
- `npm run build -w packages/types`: passed.
- `npm audit --omit=dev`: 0 high/critical and 5 moderate advisories in existing
  Prisma/Next dependency chains; no forced breaking downgrade was applied.
