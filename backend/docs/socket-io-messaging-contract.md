# Socket.IO messaging contract

Phase 5.9B documents this transport separately from the HTTP OpenAPI document.
The namespace is `/messaging`. A client supplies a valid Supabase access token
only as `auth.accessToken`; query-string tokens are rejected because URLs are
commonly logged. Disabled, invalid, or expired identities cannot connect.

Socket.IO is notification-only. Message creation remains the transactional REST
command `POST /api/v1/inquiries/:id/messages`. A committed message produces an
opaque event containing only inquiry/message identifiers and sequence metadata.
No message body, address, credential, payment data, access token, or participant
profile is put in Redis or a socket event.

Supported client events are bounded subscribe, unsubscribe, and heartbeat
operations. Authorization is rechecked against the inquiry participant record;
an unrelated user receives no existence-revealing detail. Per-user connection
caps remain in force. Distributed Redis policies separately limit connections
(`websocket_connect`: 20/minute) and client events (`websocket_event`:
120/minute). Both fail closed if Redis is unavailable. Redis keys use hashed
subjects and bounded policy names.

Delivery is a hint, not a durable message stream. After reconnect—or whenever a
sequence gap is observed—the participant calls
`GET /api/v1/inquiries/:id?afterSequence=<last-seen>&limit=<bounded-limit>` and
advances the local cursor monotonically. REST commit success does not depend on
Socket.IO publication success. PostgreSQL Outbox remains the transactional
boundary and the Redis adapter propagates notifications between instances.

Relevant failures use bounded codes and do not echo tokens or payloads. Do not
add message writes, replay bodies, or private participant state to this socket
contract without a new reviewed phase.
