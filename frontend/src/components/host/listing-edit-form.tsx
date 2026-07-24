"use client";

import { useMemo, useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import ListingFormFields, {
  type ListingFormValues,
} from "@/components/host/listing-form-fields";
import { isValidTimeZone } from "@/components/host/timezone-select";
import { useAuth } from "@/components/auth/auth-provider";
import { updateListing } from "@/lib/api/host-listings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type {
  ListingDetail,
  ProximityTag,
  SpecialFeature,
  StayDuration,
  UpdateListingInput,
} from "@/lib/api/types";

const CHECKOUT_TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function recoveryHintFor(code: string) {
  switch (code) {
    case "LISTING_LOCATION_CHANGE_BLOCKED":
      return "The address can't be changed while this listing has active bookings.";
    case "AVAILABILITY_DEDICATED_ENDPOINT_REQUIRED":
      return "Manage availability from the Availability section, not this form.";
    case "LISTING_TIMEZONE_INVALID":
      return "Choose a valid IANA time zone such as America/Chicago.";
    case "LISTING_STATUS_NOT_ALLOWED":
      return "This listing's status doesn't allow this change right now.";
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

function placesText(listing: ListingDetail, type: string) {
  return listing.places
    .filter((place) => place.type === type)
    .map((place) => place.label)
    .join("\n");
}

function toFormValues(listing: ListingDetail): ListingFormValues {
  return {
    title: listing.title,
    description: listing.description,
    city: listing.city,
    timeZone: listing.timeZone,
    checkoutTime: listing.checkoutTime ?? "11:00",
    address: listing.exactLocation?.address ?? "",
    placeId: null,
    price: (listing.priceCents / 100).toString(),
    priceUnit: listing.priceUnit,
    listingType: listing.listingType,
    category: listing.category ?? "",
    stayDurations: [...listing.stayDurations] as StayDuration[],
    proximityTags: [...listing.proximityTags] as ProximityTag[],
    specialFeatures: [...listing.specialFeatures] as SpecialFeature[],
    neighborhoodPerks: placesText(listing, "neighborhood_perk"),
    localRecommendations: placesText(listing, "local_recommendation"),
  };
}

export default function ListingEditForm({
  listing,
  onUpdated,
}: {
  listing: ListingDetail;
  onUpdated: (updated: ListingDetail) => void;
}) {
  const { accessToken } = useAuth();
  const initial = useMemo(() => toFormValues(listing), [listing]);
  const [values, setValues] = useState<ListingFormValues>(initial);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [backendError, setBackendError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const update = (patch: Partial<ListingFormValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    setSaved(false);
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

  const buildPatch = (): UpdateListingInput => {
    // Scalar/array fields are cheap to set and reflect exactly what the Host
    // sees. The address is only sent when it actually changed, to avoid an
    // unnecessary re-geocode / location-change on save.
    const patch: UpdateListingInput = {
      title: values.title.trim(),
      description: values.description.trim(),
      city: values.city.trim(),
      timeZone: values.timeZone.trim(),
      checkoutTime: values.checkoutTime,
      priceCents: Math.round(Number(values.price) * 100),
      priceUnit: values.priceUnit as UpdateListingInput["priceUnit"],
      listingType: values.listingType as UpdateListingInput["listingType"],
      category: values.category.trim(),
      stayDurations: values.stayDurations,
      proximityTags: values.proximityTags,
      specialFeatures: values.specialFeatures,
      neighborhoodPerks: toLines(values.neighborhoodPerks),
      localRecommendations: toLines(values.localRecommendations),
    };
    if (values.address.trim() !== initial.address.trim()) {
      patch.address = values.address.trim();
      if (values.placeId) patch.placeId = values.placeId;
    }
    return patch;
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
    setSaving(true);
    try {
      const updated = await updateListing(
        listing.id,
        buildPatch(),
        accessToken ?? undefined
      );
      onUpdated(updated);
      setValues(toFormValues(updated));
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setBackendError({ code: err.code, message: err.message });
      } else {
        setBackendError({ code: "UNKNOWN", message: toErrorMessage(err) });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8" aria-label="Edit listing">
      <ListingFormFields values={values} onChange={update} />

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
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-green-700">
            <CircleCheck className="size-4" aria-hidden="true" />
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
