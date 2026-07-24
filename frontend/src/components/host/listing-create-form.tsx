"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import SectionHeading from "@/components/layout/section-heading";
import { ListingStatusBadge } from "@/components/ui/status-badge";
import ListingPhotoManager from "@/components/host/listing-photo-manager";
import ListingFormFields, {
  type ListingFormValues,
} from "@/components/host/listing-form-fields";
import {
  detectBrowserTimeZone,
  isValidTimeZone,
} from "@/components/host/timezone-select";
import { useAuth } from "@/components/auth/auth-provider";
import { createListing } from "@/lib/api/host-listings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type { CreatedListing, CreateListingInput } from "@/lib/api/types";

const CHECKOUT_TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function recoveryHintFor(code: string) {
  switch (code) {
    case "FORBIDDEN":
      return "Listing creation requires a host account. If you signed up as a renter, this action is not permitted.";
    case "USER_NOT_SYNCED":
      return "Your MediCN profile has not finished setting up. Sign out and back in, then retry.";
    case "LISTING_TIMEZONE_INVALID":
      return "Choose a valid IANA time zone such as America/Chicago.";
    default:
      return null;
  }
}

function toLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 20);
}

function initialValues(): ListingFormValues {
  return {
    title: "",
    description: "",
    city: "",
    timeZone: detectBrowserTimeZone(),
    checkoutTime: "11:00",
    address: "",
    placeId: null,
    price: "",
    priceUnit: "night",
    listingType: "private_room",
    category: "",
    stayDurations: [],
    proximityTags: [],
    specialFeatures: [],
    neighborhoodPerks: "",
    localRecommendations: "",
  };
}

export default function ListingCreateForm() {
  const { accessToken } = useAuth();

  const [values, setValues] = useState<ListingFormValues>(initialValues);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [backendError, setBackendError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedListing | null>(null);

  const update = (patch: Partial<ListingFormValues>) => {
    setValues((current) => ({ ...current, ...patch }));
  };

  const validate = (): string | null => {
    if (!values.title.trim()) return "Add a listing title.";
    if (!values.description.trim()) return "Add a description.";
    if (!values.city.trim()) return "Add a city.";
    const priceValue = Number(values.price);
    if (!values.price || !Number.isFinite(priceValue) || priceValue < 0) {
      return "Enter a valid price.";
    }
    if (!isValidTimeZone(values.timeZone)) {
      return "Choose a valid time zone (e.g. America/Chicago).";
    }
    if (!CHECKOUT_TIME_PATTERN.test(values.checkoutTime)) {
      return "Enter a valid check-out time (HH:MM).";
    }
    return null;
  };

  const buildPayload = (): CreateListingInput => {
    const payload: CreateListingInput = {
      title: values.title.trim(),
      description: values.description.trim(),
      city: values.city.trim(),
      timeZone: values.timeZone.trim(),
      checkoutTime: values.checkoutTime,
      priceCents: Math.round(Number(values.price) * 100),
      priceUnit: values.priceUnit as CreateListingInput["priceUnit"],
      listingType: values.listingType as CreateListingInput["listingType"],
    };
    if (values.address.trim()) payload.address = values.address.trim();
    if (values.placeId) payload.placeId = values.placeId;
    if (values.category.trim()) payload.category = values.category.trim();
    if (values.stayDurations.length) payload.stayDurations = values.stayDurations;
    if (values.proximityTags.length) payload.proximityTags = values.proximityTags;
    if (values.specialFeatures.length)
      payload.specialFeatures = values.specialFeatures;
    const perks = toLines(values.neighborhoodPerks);
    if (perks.length) payload.neighborhoodPerks = perks;
    const recs = toLines(values.localRecommendations);
    if (recs.length) payload.localRecommendations = recs;
    return payload;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBackendError(null);
    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    setSubmitting(true);
    try {
      const result = await createListing(buildPayload(), accessToken ?? undefined);
      setCreated(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setBackendError({ code: err.code, message: err.message });
      } else {
        setBackendError({ code: "UNKNOWN", message: toErrorMessage(err) });
      }
    } finally {
      setSubmitting(false);
    }
  };

  // --- Success: real listing created. It starts as "pending" review and is not
  // publicly visible until an admin approves it. Photos and availability are
  // managed here (and on the listing management page) after creation. ---
  if (created) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 rounded-xl border border-green-200 bg-green-50 p-5">
          <div className="flex items-center gap-2">
            <CircleCheck className="size-6 text-green-600" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-green-900">
              Listing created
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-green-900">
            <span>Status:</span>
            <ListingStatusBadge status={created.status} />
          </div>
          <p className="text-sm text-green-900">
            Your listing is pending review and will appear in search once
            approved. Reference:{" "}
            <span className="font-mono text-xs">{created.id}</span>
          </p>
        </div>

        <section className="flex flex-col gap-3 rounded-xl border border-slate-200 p-5">
          <SectionHeading
            title="Add photos"
            description="Upload photos now. They are processed by MediCN before publishing."
          />
          <ListingPhotoManager listingId={created.id} initialPhotos={[]} />
        </section>

        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/host/listings/${created.id}`}>
            Manage listing
          </ButtonLink>
          <ButtonLink href="/host/listings" variant="outline">
            My listings
          </ButtonLink>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Create another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-8"
      aria-label="Create listing"
    >
      <ListingFormFields values={values} onChange={update} />

      <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
        You&apos;ll set available and blocked dates on the listing management
        page after it&apos;s created.
      </p>

      {validationError && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {validationError}
        </p>
      )}

      {backendError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <CircleAlert className="size-4" aria-hidden="true" />
            {backendError.message}
          </p>
          {recoveryHintFor(backendError.code) && (
            <p className="text-xs text-red-700">
              {recoveryHintFor(backendError.code)}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-slate-200 pt-6">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Publishing…" : "Publish listing"}
        </Button>
        <span className="text-sm text-slate-500">
          Listings are reviewed before appearing in search.
        </span>
      </div>
    </form>
  );
}
