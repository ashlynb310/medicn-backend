# MediCN API Design

## Tech Stack

Backend: Node.js + NestJS  
Database: PostgreSQL  
ORM: Prisma  
Auth: Supabase Auth  
Storage: Supabase Storage  
Maps: Google Maps Platform  
Verification: Veriff  
Payments: Stripe  
AI Review: Claude API or OpenAI API for automatic preliminary verification review

## API Standards

The base path for the MVP is:

```text
/api/v1
```

For protected endpoints, the frontend sends the Supabase Auth access token in the `Authorization` header:

```http
Authorization: Bearer <supabase_access_token>
```

The backend verifies the Supabase access token and maps the Supabase user ID to the internal MediCN `User` record in PostgreSQL.

The backend does not provide custom signup, login, logout, password reset, or email verification endpoints. Those flows are handled by Supabase Auth.

## Response Template

### Successful Response

```json
{
  "data": {},
  "meta": {},
  "error": null
}
```

### Error Response

```json
{
  "data": null,
  "meta": {},
  "error": {
    "code": "ERROR_TYPE",
    "message": "Error Msg",
    "details": {
      "fields": {
        "title": "Error reason"
      }
    }
  }
}
```

### Proposed Error Types


| Error Code | Meaning | Example Use Case |
| --- | --- | --- |
| `UNAUTHORIZED` | The user is not authenticated. | Missing or invalid login token. |
| `FORBIDDEN` | The user is authenticated but does not have permission. | A renter tries to approve a listing. |
| `NOT_FOUND` | The requested resource does not exist. | Listing ID does not match any listing. |
| `VALIDATION_ERROR` | The request body or query parameters are invalid. | Missing title or invalid price. |
| `INVALID_SUPABASE_TOKEN` | The Supabase access token is invalid or expired. | Backend cannot verify the token. |
| `USER_NOT_SYNCED` | The Supabase user exists, but no matching MediCN user exists yet. | First login before internal user sync. |
| `EMAIL_NOT_VERIFIED` | The user is authenticated but has not confirmed their email. | User tries to contact a host, request a booking, pay, or publish a listing before confirming email. |
| `VERIFICATION_REQUIRED` | Healthcare verification is required before continuing. | Renter tries to contact a host before verification. |
| `LISTING_NOT_AVAILABLE` | The listing cannot be used for this action. | Listing is pending, hidden, deleted, or unavailable. |
| `BOOKING_NOT_AVAILABLE` | The booking cannot be completed or modified. | Selected dates are unavailable or booking was canceled. |
| `PAYMENT_FAILED` | Payment could not be completed. | Stripe payment failed. |
| `WEBHOOK_SIGNATURE_INVALID` | Webhook signature verification failed. | Request was not actually sent by Veriff, Stripe, or another trusted provider. |
| `RATE_LIMITED` | Too many requests were sent in a short time. | User repeatedly submits the same form. |
| `INTERNAL_SERVER_ERROR` | Unexpected backend error. | Database or server failure. |

## Endpoint Summary

### Authentication

| Method | Endpoint | Purpose | Auth |
| --- | --- | --- | --- |
| GET | `/api/v1/auth/me` | Get current MediCN user | Required |
| POST | `/api/v1/auth/sync` | Create or update internal user from Supabase Auth | Required |

### Users

| Method | Endpoint | Purpose | Auth |
| --- | --- | --- | --- |
| PATCH | `/api/v1/users/me` | Update current user profile | Required |
| GET | `/api/v1/users/:id` | Get public user profile | Optional |

### Listings

| Method | Endpoint | Purpose | Auth |
| --- | --- | --- | --- |
| GET | `/api/v1/listings` | Search and list listings | Optional |
| GET | `/api/v1/listings/:id` | Get listing details | Optional |
| POST | `/api/v1/listings` | Create listing | Required, Host |
| PATCH | `/api/v1/listings/:id` | Update listing | Required, Host owner/Admin |
| DELETE | `/api/v1/listings/:id` | Delete/archive listing | Required, Host owner/Admin |
| POST | `/api/v1/listings/:id/photos` | Add listing photo | Required, Host owner |
| POST | `/api/v1/uploads/presigned-url` | Create controlled upload URL/path | Required |

### Verification

| Method | Endpoint | Purpose | Auth |
| --- | --- | --- | --- |
| POST | `/api/v1/verifications/veriff-session` | Create Veriff session | Required |
| GET | `/api/v1/verifications/me` | Get current user's verification status | Required |
| POST | `/api/v1/webhooks/veriff` | Receive Veriff status updates | Webhook signature |

### Inquiries and Messages

| Method | Endpoint | Purpose | Auth |
| --- | --- | --- | --- |
| POST | `/api/v1/listings/:id/inquiries` | Contact host / create inquiry | Required, Renter |
| GET | `/api/v1/inquiries` | Get current user's inquiries | Required |
| GET | `/api/v1/inquiries/:id` | Get inquiry details and messages | Required |
| POST | `/api/v1/inquiries/:id/messages` | Send message in inquiry thread | Required |

### Bookings and Payments

| Method | Endpoint | Purpose | Auth |
| --- | --- | --- | --- |
| POST | `/api/v1/bookings` | Request to book listing | Required, Renter |
| GET | `/api/v1/bookings` | Get current user's bookings | Required |
| GET | `/api/v1/bookings/:id` | Get booking details | Required |
| POST | `/api/v1/payments/checkout-session` | Create Stripe Checkout Session | Required |
| POST | `/api/v1/webhooks/stripe` | Receive Stripe payment events | Webhook signature |

### Reviews

| Method | Endpoint | Purpose | Auth |
| --- | --- | --- | --- |
| GET | `/api/v1/listings/:id/reviews` | Get listing reviews | Optional |
| POST | `/api/v1/listings/:id/reviews` | Create listing review | Required, completed booking |

### Admin

| Method | Endpoint | Purpose | Auth |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/listings/pending` | Get listings pending approval | Required, Admin |
| PATCH | `/api/v1/admin/listings/:id/approve` | Approve listing | Required, Admin |
| PATCH | `/api/v1/admin/listings/:id/reject` | Reject listing | Required, Admin |
| GET | `/api/v1/admin/verifications` | View verification records | Required, Admin |
| PATCH | `/api/v1/admin/verifications/:id` | Update verification record | Required, Admin |

## Detailed Endpoints

## Authentication

Authentication Flow:
1. User signs up or logs in through Supabase Auth on the frontend.
2. Supabase creates a session and provides an access token to the frontend.
3. Signup metadata may include `user_type`, `first_name`, `last_name`, `display_name`, and `healthcare_role`.
4. For protected API requests, the frontend sends the Supabase access token in the `Authorization` header.
5. Backend verifies the access token with Supabase Auth.
6. Backend extracts the Supabase user ID and email confirmation status from the verified user.
7. Backend maps the Supabase user ID to the internal MediCN `User` record.
8. If the internal user is missing, the frontend can call `/api/v1/auth/sync`.
9. Backend returns the MediCN user data to the frontend, including `emailVerified` and `emailVerifiedAt`.
10. Accounts may exist before email confirmation, but email-gated business features should return `EMAIL_NOT_VERIFIED` until `emailVerified` is `true`.
   
### GET `/api/v1/auth/me`

Returns the current authenticated MediCN user.

1. Reads Supabase access token from the `Authorization` header.
2. Verifies the access token with Supabase Auth.
3. Extracts the Supabase user ID from the verified user.
4. Finds the matching internal PostgreSQL user by `supabaseUserId`.
5. Returns the internal MediCN user record.

If `/auth/me` cannot find a matching internal user because the profile has not been synced yet, it returns `USER_NOT_SYNCED`. The frontend may then call `/api/v1/auth/sync` as a repair step.

```json
{
    "data": {
    "id": "user_123",
    "supabaseUserId": "supabase_user_abc",
    "email": "user@example.com",
    "emailVerified": false,
    "emailVerifiedAt": null,
    "firstName": "Alex",
    "lastName": "Chen",
    "displayName": "Alex C",
    "healthcareRole": "medical_student",
    "roles": [],
    "profileComplete": false
  },
  "meta": {},
  "error": null
}
```

### POST `/api/v1/auth/sync`

Endpoint for synchronizing the current Supabase Auth user into MediCN.

This endpoint is mainly used for:

- Repairing a missing internal user record.
- Creating the internal profile after first signup/login.
- Syncing allowed profile metadata from Supabase Auth.

1. Verifies the Supabase access token.
2. Extracts the Supabase user ID, email, email confirmation timestamp, and allowed metadata.
3. Creates or updates the internal `User` record.
4. Maps `user_type` to `renter` or `host` only when creating a new internal profile.
5. Maps `healthcare_role` to the allowed healthcare role enum.
6. Syncs `emailVerifiedAt` from Supabase Auth when Supabase provides email confirmation status.
7. Returns the MediCN user record.

Auth: Required

```json
{
    "data": {
    "id": "user_123",
    "supabaseUserId": "supabase_user_abc",
    "email": "user@example.com",
    "emailVerified": true,
    "emailVerifiedAt": "2026-06-16T01:02:03.000Z",
    "firstName": "Alex",
    "lastName": "Chen",
    "displayName": "Alex C",
    "healthcareRole": "medical_student",
    "roles": ["renter"],
    "profileComplete": true
  },
  "meta": {},
  "error": null
}
```

## Users

### PATCH `/api/v1/users/me`

Updates the current user's MediCN profile.

Auth: Required

Request:

```json
{
  "firstName": "Alex",
  "lastName": "Chen",
  "displayName": "Alex C",
  "healthcareRole": "medical_student",
  "healthcareAffiliation": "Northwestern Medicine",
  "phoneNumber": "+13125550123",
  "bio": "Medical student looking for short-term housing near hospitals."
}
```

Response:

```json
{
  "data": {
    "id": "user_123",
    "email": "user@example.com",
    "emailVerified": true,
    "emailVerifiedAt": "2026-06-16T01:02:03.000Z",
    "firstName": "Alex",
    "lastName": "Chen",
    "displayName": "Alex C",
    "healthcareRole": "medical_student",
    "roles": ["renter"],
    "profileComplete": true
  },
  "meta": {},
  "error": null
}
```

### GET `/api/v1/users/:id`

Returns a public user profile, usually for a listing host.

Auth: Optional

Response:

```json
{
  "data": {
    "id": "user_456",
    "firstName": "Maya",
    "lastName": "H.",
    "displayName": "Maya H",
    "healthcareRole": "other",
    "roles": ["host"],
    "bio": "Hello, I am a host near the medical district.",
    "profilePhotoUrl": "https://storage.example.com/profile.jpg"
  },
  "meta": {},
  "error": null
}
```

## Listings

### GET `/api/v1/listings`

Searches and lists approved public listings.

Auth: Optional

Query parameters:

```text
location: free-text location search
bounds: north,east,south,west map bounds
city: city name
nearbyHospital: hospital or clinic name
listingType: private_room|entire_home|shared_room
category: housing category
stayDuration: short_term|medium_term|long_term
startDate: ISO date
endDate: ISO date
minPrice: minimum price
maxPrice: maximum price
priceUnit: day|night|month
sort: newest|price_asc|price_desc
page: page number
limit: results per page
```

Example:

```http
GET /api/v1/listings?city=Houston&stayDuration=short_term&minPrice=500&maxPrice=2000&page=1&limit=20
```

Response:

```json
{
  "data": [
    {
      "id": "listing_123",
      "title": "Private room near hospital",
      "city": "Houston",
      "priceCents": 8000,
      "currency": "USD",
      "priceUnit": "day",
      "coverPhotoUrl": "https://storage.example.com/photo.jpg",
      "stayDurations": ["short_term", "medium_term"],
      "host": {
        "id": "user_456",
        "firstName": "Maya"
      }
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 31
  },
  "error": null
}
```

### GET `/api/v1/listings/:id`

Gets full listing details.

Auth: Optional

Response:

```json
{
  "data": {
    "id": "listing_123",
    "title": "Private room near hospital",
    "description": "Clean furnished room for medical travelers.",
    "city": "Houston",
    "address": "123 Main St",
    "latitude": 29.7604,
    "longitude": -95.3698,
    "priceCents": 8000,
    "currency": "USD",
    "priceUnit": "day",
    "status": "approved",
    "stayDurations": ["short_term", "medium_term"],
    "proximityTags": ["near_hospitals", "public_transit"],
    "specialFeatures": ["fully_furnished", "pet_friendly", "access_24_7"],
    "neighborhoodPerks": [
      {
        "label": "Houston Methodist Hospital",
        "mapsUrl": "https://www.google.com/maps/search/?api=1&query=Houston%20Methodist%20Hospital"
      }
    ],
    "localRecommendations": [
      {
        "label": "Houston Zoo",
        "mapsUrl": "https://www.google.com/maps/search/?api=1&query=Houston%20Zoo"
      }
    ],
    "photos": [
      {
        "id": "photo_123",
        "fileUrl": "https://storage.example.com/listing-photo.jpg",
        "displayOrder": 1
      }
    ],
    "host": {
      "id": "user_456",
      "firstName": "Maya",
      "bio": "Hello, I am a host."
    }
  },
  "meta": {},
  "error": null
}
```

### POST `/api/v1/listings`

Creates a listing.

Auth: Required  
Role: Host

If email gating is enabled, the host must have `emailVerified` set to `true`; otherwise the API returns `EMAIL_NOT_VERIFIED`.

Request:

```json
{
  "title": "Private room near hospital",
  "description": "Clean furnished room for medical travelers.",
  "city": "Houston",
  "address": "123 Main St",
  "latitude": 29.7604,
  "longitude": -95.3698,
  "priceCents": 8000,
  "currency": "USD",
  "priceUnit": "day",
  "listingType": "private_room",
  "stayDurations": ["short_term", "medium_term"],
  "proximityTags": ["near_hospitals", "public_transit"],
  "specialFeatures": ["fully_furnished", "pet_friendly"],
  "neighborhoodPerks": ["Houston Methodist Hospital"],
  "localRecommendations": ["Houston Zoo"],
  "availability": [
    {
      "startDate": "2026-07-01",
      "endDate": "2026-09-30"
    }
  ]
}
```

Response:

```json
{
  "data": {
    "id": "listing_123",
    "status": "pending"
  },
  "meta": {},
  "error": null
}
```

### PATCH `/api/v1/listings/:id`

Updates a listing.

Auth: Required  
Access: Host owner or Admin

### DELETE `/api/v1/listings/:id`

Archives or deletes a listing.

Auth: Required  
Access: Host owner or Admin

### POST `/api/v1/uploads/presigned-url`

Creates a controlled upload URL or storage path for listing photos.

Auth: Required

Request:

```json
{
  "purpose": "listing_photo",
  "fileName": "living-room.jpg",
  "contentType": "image/jpeg"
}
```

Response:

```json
{
  "data": {
    "uploadUrl": "https://storage.example.com/signed-upload-url",
    "fileUrl": "https://storage.example.com/listings/listing_123/living-room.jpg",
    "storagePath": "listings/listing_123/living-room.jpg"
  },
  "meta": {},
  "error": null
}
```

### POST `/api/v1/listings/:id/photos`

Adds a listing photo after the frontend uploads the image to the controlled Supabase Storage path.

Auth: Required  
Access: Host owner

Request:

```json
{
  "storagePath": "listings/listing_123/living-room.jpg",
  "displayOrder": 1
}
```

The backend should only accept storage paths generated by MediCN, not arbitrary external image URLs.

## Verification

### POST `/api/v1/verifications/veriff-session`

Creates a Veriff verification session for the current user.

Auth: Required

Response:

```json
{
  "data": {
    "verificationId": "verification_123",
    "veriffSessionId": "veriff_session_abc",
    "redirectUrl": "https://veriff.com/session/abc",
    "status": "pending"
  },
  "meta": {},
  "error": null
}
```

### GET `/api/v1/verifications/me`

Returns the current user's verification status.

Auth: Required

Response:

```json
{
  "data": {
    "status": "approved",
    "submittedAt": "2026-06-01T10:00:00.000Z",
    "reviewedAt": "2026-06-02T10:00:00.000Z",
    "expiresAt": "2027-06-02T10:00:00.000Z"
  },
  "meta": {},
  "error": null
}
```

### POST `/api/v1/webhooks/veriff`

Receives Veriff verification status updates.

Auth: Veriff webhook signature required

When a verification record becomes ready for review, the backend automatically starts an AI-assisted preliminary review. The AI review result is stored on the verification record and shown to admins in the admin verification dashboard. AI review does not automatically approve or reject the user.

## Inquiries and Messages

### POST `/api/v1/listings/:id/inquiries`

Creates an inquiry/contact request for a listing host.

Auth: Required  
Role: Renter

If verification gating is enabled, the renter must have an approved healthcare verification before creating an inquiry.
If email gating is enabled, the renter must also have `emailVerified` set to `true`; otherwise the API returns `EMAIL_NOT_VERIFIED`.

Request:

```json
{
  "message": "Hi, is this room available from July to September?"
}
```

Response:

```json
{
  "data": {
    "id": "inquiry_123",
    "listingId": "listing_123",
    "status": "open"
  },
  "meta": {},
  "error": null
}
```

### GET `/api/v1/inquiries`

Gets the current user's inquiry threads.

Auth: Required

### GET `/api/v1/inquiries/:id`

Gets one inquiry thread and its messages.

Auth: Required  
Access: Inquiry renter, listing host, or Admin

### POST `/api/v1/inquiries/:id/messages`

Sends a message in an inquiry thread.

Auth: Required

Request:

```json
{
  "body": "Yes, it is available for those dates."
}
```

## Bookings and Payments

### POST `/api/v1/bookings`

Creates a booking request for a listing.

Auth: Required  
Role: Renter

If email gating is enabled, the renter must have `emailVerified` set to `true`; otherwise the API returns `EMAIL_NOT_VERIFIED`.

Request:

```json
{
  "listingId": "listing_123",
  "startDate": "2026-07-01",
  "endDate": "2026-07-14",
  "selectedOption": "daily_short_term",
  "additionalRequests": "I prefer a quiet room if possible."
}
```

Response:

```json
{
  "data": {
    "id": "booking_123",
    "listingId": "listing_123",
    "status": "requested",
    "totalAmount": 1120
  },
  "meta": {},
  "error": null
}
```

### GET `/api/v1/bookings`

Gets the current user's bookings.

Auth: Required

### GET `/api/v1/bookings/:id`

Gets booking details.

Auth: Required  
Access: Booking renter, listing host, or Admin

### POST `/api/v1/payments/checkout-session`

Creates a Stripe Checkout Session for an approved booking.

Auth: Required

If email gating is enabled, the current user must have `emailVerified` set to `true`; otherwise the API returns `EMAIL_NOT_VERIFIED`.

Request:

```json
{
  "bookingId": "booking_123"
}
```

The backend calculates the final amount from the booking dates, listing price, fees, and discounts. The frontend must not send trusted payment amounts.

Response:

```json
{
  "data": {
    "checkoutSessionId": "cs_test_123",
    "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_123"
  },
  "meta": {},
  "error": null
}
```

### POST `/api/v1/webhooks/stripe`

Receives Stripe payment events.

Events:

- `checkout.session.completed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `charge.dispute.created`

Auth: Stripe webhook signature required

## Reviews

### GET `/api/v1/listings/:id/reviews`

Gets reviews for a listing.

Auth: Optional

Response:

```json
{
  "data": [
    {
      "id": "review_123",
      "rating": 5,
      "comment": "Great stay near the hospital.",
      "reviewer": {
        "id": "user_123",
        "firstName": "Alex"
      },
      "createdAt": "2026-06-01T10:00:00.000Z"
    }
  ],
  "meta": {
    "total": 1
  },
  "error": null
}
```

### POST `/api/v1/listings/:id/reviews`

Creates a review after a completed booking.

Auth: Required  
Access: Renter with completed booking

Request:

```json
{
  "bookingId": "booking_123",
  "rating": 5,
  "comment": "Great stay near the hospital."
}
```

## Admin

### GET `/api/v1/admin/listings/pending`

Gets listings waiting for admin approval.

Auth: Required  
Role: Admin

### PATCH `/api/v1/admin/listings/:id/approve`

Approves a listing.

Auth: Required  
Role: Admin

Response:

```json
{
  "data": {
    "id": "listing_123",
    "status": "approved"
  },
  "meta": {},
  "error": null
}
```

### PATCH `/api/v1/admin/listings/:id/reject`

Rejects a listing.

Auth: Required  
Role: Admin

Request:

```json
{
  "reason": "Missing required listing photos."
}
```

### GET `/api/v1/admin/verifications`

Gets healthcare verification records for admin review, including AI review recommendations when available.

Auth: Required  
Role: Admin

Query parameters:

```text
status: not_started|pending|approved|rejected|expired
page: page number
limit: results per page
```

Response:

```json
{
  "data": [
    {
      "id": "verification_123",
      "userId": "user_123",
      "userName": "Alex Chen",
      "healthcareAffiliation": "Northwestern Medicine",
      "status": "pending",
      "aiReviewStatus": "completed",
      "aiRecommendation": "approve",
      "aiConfidence": 0.87,
      "aiReason": "Submitted document appears to show a healthcare organization badge with a matching name.",
      "submittedAt": "2026-06-08T09:30:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  },
  "error": null
}
```

Possible `aiReviewStatus` values:

```text
not_started
processing
completed
failed
```

Possible `aiRecommendation` values:

```text
approve
reject
needs_manual_review
```

AI review runs automatically after a verification record becomes ready for review. It is only a preliminary recommendation. Final verification status must be confirmed by an admin through `PATCH /api/v1/admin/verifications/:id`.

### PATCH `/api/v1/admin/verifications/:id`

Updates a verification record after admin review.

Auth: Required  
Role: Admin

Request:

```json
{
  "status": "approved",
  "note": "Approved after AI-assisted review and manual confirmation."
}
```

Response:

```json
{
  "data": {
    "id": "verification_123",
    "status": "approved",
    "aiRecommendation": "approve",
    "aiConfidence": 0.87,
    "reviewedByAdminId": "user_admin_123",
    "reviewedAt": "2026-06-08T10:00:00.000Z"
  },
  "meta": {},
  "error": null
}
```
