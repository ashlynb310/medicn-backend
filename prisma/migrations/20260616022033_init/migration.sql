-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('renter', 'host', 'admin');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('not_started', 'pending', 'approved', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "AiReviewStatus" AS ENUM ('not_started', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "AiRecommendation" AS ENUM ('approve', 'reject', 'needs_manual_review');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('draft', 'pending', 'approved', 'rejected', 'hidden', 'archived');

-- CreateEnum
CREATE TYPE "PriceUnit" AS ENUM ('day', 'night', 'month');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('private_room', 'entire_home', 'shared_room');

-- CreateEnum
CREATE TYPE "StayDuration" AS ENUM ('short_term', 'medium_term', 'long_term');

-- CreateEnum
CREATE TYPE "ProximityTag" AS ENUM ('near_hospitals', 'public_transit');

-- CreateEnum
CREATE TYPE "SpecialFeature" AS ENUM ('fully_furnished', 'pet_friendly', 'access_24_7');

-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('available', 'blocked');

-- CreateEnum
CREATE TYPE "ListingPlaceType" AS ENUM ('neighborhood_perk', 'local_recommendation');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('open', 'closed', 'archived');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('requested', 'accepted', 'rejected', 'cancelled', 'payment_pending', 'paid', 'completed');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'failed', 'refunded', 'disputed');

-- CreateEnum
CREATE TYPE "AdminTargetType" AS ENUM ('listing', 'verification', 'user');

-- CreateEnum
CREATE TYPE "AdminActionType" AS ENUM ('approve', 'reject', 'hide', 'disable_user');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "roles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[],
    "healthcareAffiliation" TEXT,
    "phoneNumber" TEXT,
    "bio" TEXT,
    "profilePhotoUrl" TEXT,
    "profileComplete" BOOLEAN NOT NULL DEFAULT false,
    "currentVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'not_started',
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthcareVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "veriffSessionId" TEXT,
    "veriffStatus" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'not_started',
    "aiReviewStatus" "AiReviewStatus" NOT NULL DEFAULT 'not_started',
    "aiRecommendation" "AiRecommendation",
    "aiConfidence" DECIMAL(4,3),
    "aiReason" TEXT,
    "aiReviewedAt" TIMESTAMP(3),
    "reviewedByAdminId" TEXT,
    "adminReviewNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthcareVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "priceUnit" "PriceUnit" NOT NULL,
    "listingType" "ListingType" NOT NULL,
    "category" TEXT,
    "status" "ListingStatus" NOT NULL DEFAULT 'pending',
    "stayDurations" "StayDuration"[] DEFAULT ARRAY[]::"StayDuration"[],
    "proximityTags" "ProximityTag"[] DEFAULT ARRAY[]::"ProximityTag"[],
    "specialFeatures" "SpecialFeature"[] DEFAULT ARRAY[]::"SpecialFeature"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingPhoto" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingAvailability" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "AvailabilityStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingPlace" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "type" "ListingPlaceType" NOT NULL,
    "label" TEXT NOT NULL,
    "googlePlaceId" TEXT,
    "mapsUrl" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingPlace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "renterId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "status" "InquiryStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "renterId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "selectedOption" TEXT NOT NULL,
    "additionalRequests" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'requested',
    "totalAmountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "providerCheckoutSessionId" TEXT,
    "providerPaymentIntentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAction" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "targetType" "AdminTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" "AdminActionType" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_clerkUserId_idx" ON "User"("clerkUserId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "HealthcareVerification_veriffSessionId_key" ON "HealthcareVerification"("veriffSessionId");

-- CreateIndex
CREATE INDEX "HealthcareVerification_userId_idx" ON "HealthcareVerification"("userId");

-- CreateIndex
CREATE INDEX "HealthcareVerification_status_idx" ON "HealthcareVerification"("status");

-- CreateIndex
CREATE INDEX "Listing_hostId_idx" ON "Listing"("hostId");

-- CreateIndex
CREATE INDEX "Listing_city_idx" ON "Listing"("city");

-- CreateIndex
CREATE INDEX "Listing_status_idx" ON "Listing"("status");

-- CreateIndex
CREATE INDEX "ListingPhoto_listingId_idx" ON "ListingPhoto"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "ListingPhoto_listingId_displayOrder_key" ON "ListingPhoto"("listingId", "displayOrder");

-- CreateIndex
CREATE INDEX "ListingAvailability_listingId_idx" ON "ListingAvailability"("listingId");

-- CreateIndex
CREATE INDEX "ListingAvailability_startDate_endDate_idx" ON "ListingAvailability"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "ListingPlace_listingId_idx" ON "ListingPlace"("listingId");

-- CreateIndex
CREATE INDEX "Inquiry_listingId_idx" ON "Inquiry"("listingId");

-- CreateIndex
CREATE INDEX "Inquiry_renterId_idx" ON "Inquiry"("renterId");

-- CreateIndex
CREATE INDEX "Inquiry_hostId_idx" ON "Inquiry"("hostId");

-- CreateIndex
CREATE INDEX "Message_inquiryId_idx" ON "Message"("inquiryId");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "Booking_listingId_idx" ON "Booking"("listingId");

-- CreateIndex
CREATE INDEX "Booking_renterId_idx" ON "Booking"("renterId");

-- CreateIndex
CREATE INDEX "Booking_hostId_idx" ON "Booking"("hostId");

-- CreateIndex
CREATE INDEX "Booking_startDate_endDate_idx" ON "Booking"("startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerCheckoutSessionId_key" ON "Payment"("providerCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerPaymentIntentId_key" ON "Payment"("providerPaymentIntentId");

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_bookingId_key" ON "Review"("bookingId");

-- CreateIndex
CREATE INDEX "Review_listingId_idx" ON "Review"("listingId");

-- CreateIndex
CREATE INDEX "Review_reviewerId_idx" ON "Review"("reviewerId");

-- CreateIndex
CREATE INDEX "AdminAction_adminId_idx" ON "AdminAction"("adminId");

-- CreateIndex
CREATE INDEX "AdminAction_targetType_targetId_idx" ON "AdminAction"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "HealthcareVerification" ADD CONSTRAINT "HealthcareVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthcareVerification" ADD CONSTRAINT "HealthcareVerification_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPhoto" ADD CONSTRAINT "ListingPhoto_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingAvailability" ADD CONSTRAINT "ListingAvailability_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPlace" ADD CONSTRAINT "ListingPlace_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_renterId_fkey" FOREIGN KEY ("renterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_renterId_fkey" FOREIGN KEY ("renterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
