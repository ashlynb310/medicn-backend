// Shared API types matching the medicn backend response envelope and the
// listings DTOs returned by apps/api (see ListingsService.toListingSummaryDto
// and toListingDetailDto).

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResponse<TData, TMeta = Record<string, never>> =
  | { data: TData; meta: TMeta; error: null }
  | { data: null; meta: TMeta; error: ApiErrorPayload };

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export type PriceUnit = "day" | "night" | "month";
export type ListingType = "private_room" | "entire_home" | "shared_room";
export type StayDuration = "short_term" | "medium_term" | "long_term";
export type ProximityTag = "near_hospitals" | "public_transit";
export type SpecialFeature = "fully_furnished" | "pet_friendly" | "access_24_7";
export type ListingSort = "newest" | "price_asc" | "price_desc";
export type ListingStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "hidden"
  | "archived";

export interface ListingHostSummary {
  id: string;
  firstName: string | null;
  displayName: string | null;
}

export interface ListingHostDetail extends ListingHostSummary {
  lastName: string | null;
  bio: string | null;
  profilePhotoUrl: string | null;
}

export interface ListingSummary {
  id: string;
  title: string;
  city: string;
  priceCents: number;
  currency: string;
  priceUnit: PriceUnit;
  status: string;
  coverPhotoUrl: string | null;
  stayDurations: StayDuration[];
  host: ListingHostSummary;
}

export interface ListingPhoto {
  id: string;
  fileUrl: string;
  displayOrder: number;
}

export interface ListingAvailabilityWindow {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
}

export type ListingPlaceType = "neighborhood_perk" | "local_recommendation";

export interface ListingPlace {
  id: string;
  type: ListingPlaceType;
  label: string;
  googlePlaceId: string | null;
  mapsUrl: string | null;
  displayOrder: number;
}

export interface ListingDetail extends ListingSummary {
  description: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  listingType: ListingType;
  category: string | null;
  proximityTags: string[];
  specialFeatures: string[];
  createdAt: string;
  updatedAt: string;
  photos: ListingPhoto[];
  availability: ListingAvailabilityWindow[];
  places: ListingPlace[];
  host: ListingHostDetail;
}

export interface SearchListingsParams {
  location?: string;
  city?: string;
  nearbyHospital?: string;
  listingType?: ListingType;
  category?: string;
  stayDuration?: StayDuration;
  startDate?: string;
  endDate?: string;
  minPrice?: number;
  maxPrice?: number;
  priceUnit?: PriceUnit;
  sort?: ListingSort;
  page?: number;
  limit?: number;
  bounds?: string;
}

// --- Bookings (see medicn/apps/api/src/bookings) ---

// Backend BookingStatus enum (schema.prisma).
export type BookingStatus =
  | "requested"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "payment_pending"
  | "paid"
  | "completed";

// Party summary the backend embeds in a booking (host / renter).
export interface BookingPartyRef {
  id: string;
  email: string;
  firstName: string | null;
  displayName: string | null;
}

export interface BookingListingRef {
  id: string;
  title: string;
  priceUnit: PriceUnit;
  host: BookingPartyRef;
}

// Mirrors BookingsService.toBookingDto.
export interface Booking {
  id: string;
  listingId: string;
  renterId: string;
  hostId: string;
  status: BookingStatus;
  startDate: string;
  endDate: string;
  selectedOption: string;
  additionalRequests: string | null;
  totalAmountCents: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  listing: BookingListingRef;
  renter: BookingPartyRef;
}

// Matches CreateBookingDto exactly.
export interface CreateBookingInput {
  listingId: string;
  startDate: string;
  endDate: string;
  selectedOption: string;
  additionalRequests?: string;
}

export interface BookingListMeta {
  total: number;
}

// --- Host listing management (see medicn/apps/api/src/listings + uploads) ---

export interface ListingAvailabilityInput {
  startDate: string;
  endDate: string;
}

// Matches CreateListingDto exactly. Fields the DTO does not declare must NOT be
// sent — the backend ValidationPipe uses forbidNonWhitelisted.
export interface CreateListingInput {
  title: string;
  description: string;
  city: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  priceCents: number;
  priceUnit: PriceUnit;
  listingType: ListingType;
  category?: string;
  stayDurations?: StayDuration[];
  proximityTags?: ProximityTag[];
  specialFeatures?: SpecialFeature[];
  availability?: ListingAvailabilityInput[];
  neighborhoodPerks?: string[];
  localRecommendations?: string[];
}

// POST /listings returns only { id, status } (status starts as "pending").
export interface CreatedListing {
  id: string;
  status: ListingStatus;
}

// POST /uploads/presigned-url response.
export interface PresignedUpload {
  uploadUrl: string;
  fileUrl: string;
  storagePath: string;
}

// POST /listings/:id/photos response.
export interface ListingPhotoRecord {
  id: string;
  storagePath: string;
  fileUrl: string;
  displayOrder: number;
}

// --- Admin moderation (see medicn/apps/api/src/admin) ---

// Host identity fields the admin endpoints expose for moderation. Distinct from
// the public ListingHostSummary — includes email and lastName.
export interface AdminListingHost {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
}

// Mirrors AdminService.toListingDto — note: no stayDurations; has createdAt.
export interface AdminListing {
  id: string;
  title: string;
  city: string;
  priceCents: number;
  currency: string;
  priceUnit: PriceUnit;
  status: ListingStatus;
  coverPhotoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  host: AdminListingHost;
}

// Matches ModerateListingDto: status is exactly approved|rejected, note ≤1000.
export interface ModerateListingInput {
  status: "approved" | "rejected";
  note?: string;
}
