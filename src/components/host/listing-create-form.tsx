"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import FormField from "@/components/form/form-field";
import SectionHeading from "@/components/layout/section-heading";
import { ListingStatusBadge } from "@/components/ui/status-badge";
import PhotoUploadControl from "@/components/host/photo-upload-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth/auth-provider";
import { createListing } from "@/lib/api/host-listings";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type {
  CreatedListing,
  CreateListingInput,
  ProximityTag,
  SpecialFeature,
  StayDuration,
} from "@/lib/api/types";

// Field names/values mirror the backend CreateListingDto exactly (see
// medicn/apps/api/src/listings/dto/create-listing.dto.ts). The ValidationPipe
// uses forbidNonWhitelisted, so only these fields are sent.

const listingTypeItems: Record<string, string> = {
  private_room: "Private room",
  entire_home: "Entire home",
  shared_room: "Shared room",
};

const priceUnitItems: Record<string, string> = {
  day: "per day",
  night: "per night",
  month: "per month",
};

const stayDurationOptions: { value: StayDuration; label: string }[] = [
  { value: "short_term", label: "Short term" },
  { value: "medium_term", label: "Medium term" },
  { value: "long_term", label: "Long term" },
];

const proximityTagOptions: { value: ProximityTag; label: string }[] = [
  { value: "near_hospitals", label: "Near hospitals" },
  { value: "public_transit", label: "Public transit" },
];

const specialFeatureOptions: { value: SpecialFeature; label: string }[] = [
  { value: "fully_furnished", label: "Fully furnished" },
  { value: "pet_friendly", label: "Pet friendly" },
  { value: "access_24_7", label: "24/7 access" },
];

interface AvailabilityRow {
  startDate: string;
  endDate: string;
}

function recoveryHintFor(code: string) {
  switch (code) {
    case "FORBIDDEN":
      return "Listing creation requires a host account. If you signed up as a renter, this action is not permitted.";
    case "USER_NOT_SYNCED":
      return "Your MediCN profile has not finished setting up. Sign out and back in, then retry.";
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

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export default function ListingCreateForm() {
  const { accessToken } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  // timeZone is required by the backend. Default to the browser's IANA zone as
  // a confirmable suggestion (a display/scheduling default, not a privacy-
  // sensitive authoritative coordinate). The host can correct it.
  const [timeZone, setTimeZone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  });
  const [price, setPrice] = useState("");
  const [priceUnit, setPriceUnit] = useState("night");
  const [listingType, setListingType] = useState("private_room");
  const [category, setCategory] = useState("");
  const [stayDurations, setStayDurations] = useState<StayDuration[]>([]);
  const [proximityTags, setProximityTags] = useState<ProximityTag[]>([]);
  const [specialFeatures, setSpecialFeatures] = useState<SpecialFeature[]>([]);
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [neighborhoodPerks, setNeighborhoodPerks] = useState("");
  const [localRecommendations, setLocalRecommendations] = useState("");

  const [validationError, setValidationError] = useState<string | null>(null);
  const [backendError, setBackendError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedListing | null>(null);

  const updateAvailabilityRow = (
    index: number,
    field: keyof AvailabilityRow,
    value: string
  ) => {
    setAvailability((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  };

  const validate = (): string | null => {
    if (!title.trim()) return "Add a listing title.";
    if (!description.trim()) return "Add a description.";
    if (!city.trim()) return "Add a city.";
    const priceValue = Number(price);
    if (!price || !Number.isFinite(priceValue) || priceValue < 0) {
      return "Enter a valid price.";
    }
    if (!timeZone.trim()) return "Add a time zone (e.g. America/Chicago).";
    for (const row of availability) {
      if (!row.startDate || !row.endDate) {
        return "Each availability window needs a start and end date.";
      }
      if (new Date(row.endDate) <= new Date(row.startDate)) {
        return "Availability end date must be after the start date.";
      }
    }
    if (latitude && !Number.isFinite(Number(latitude))) {
      return "Latitude must be a number.";
    }
    if (longitude && !Number.isFinite(Number(longitude))) {
      return "Longitude must be a number.";
    }
    return null;
  };

  const buildPayload = (): CreateListingInput => {
    const payload: CreateListingInput = {
      title: title.trim(),
      description: description.trim(),
      city: city.trim(),
      timeZone: timeZone.trim(),
      priceCents: Math.round(Number(price) * 100),
      priceUnit: priceUnit as CreateListingInput["priceUnit"],
      listingType: listingType as CreateListingInput["listingType"],
    };
    if (address.trim()) payload.address = address.trim();
    if (latitude) payload.latitude = Number(latitude);
    if (longitude) payload.longitude = Number(longitude);
    if (category.trim()) payload.category = category.trim();
    if (stayDurations.length) payload.stayDurations = stayDurations;
    if (proximityTags.length) payload.proximityTags = proximityTags;
    if (specialFeatures.length) payload.specialFeatures = specialFeatures;
    if (availability.length) payload.availability = availability;
    const perks = toLines(neighborhoodPerks);
    if (perks.length) payload.neighborhoodPerks = perks;
    const recs = toLines(localRecommendations);
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
  // publicly visible until an admin approves it, so we do not link to the public
  // detail page (which would 404 for a pending listing). ---
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
            description="Upload photos now while your listing is pending review."
          />
          <PhotoUploadControl listingId={created.id} />
        </section>

        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/listings/${created.id}`}>View listing</ButtonLink>
          <ButtonLink href="/host/listings" variant="outline">
            My listings
          </ButtonLink>
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
          >
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
      <section className="flex flex-col gap-4">
        <SectionHeading title="Basics" />
        <FormField label="Listing title" required>
          {({ id }) => (
            <Input
              id={id}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={140}
              placeholder="Sunny room near Houston Methodist"
            />
          )}
        </FormField>
        <FormField label="Description" required>
          {({ id }) => (
            <textarea
              id={id}
              rows={4}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the space, the neighborhood, and what makes it a good fit for medical professionals."
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          )}
        </FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Listing type" required>
            {({ id }) => (
              <Select
                items={listingTypeItems}
                value={listingType}
                onValueChange={(v) => setListingType(v ?? "private_room")}
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(listingTypeItems).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Category">
            {({ id }) => (
              <Input
                id={id}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                maxLength={120}
                placeholder="e.g. Furnished"
              />
            )}
          </FormField>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="Price ($)" required>
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="120"
                />
              )}
            </FormField>
            <FormField label="Unit" required>
              {({ id }) => (
                <Select
                  items={priceUnitItems}
                  value={priceUnit}
                  onValueChange={(v) => setPriceUnit(v ?? "night")}
                >
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(priceUnitItems).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Location"
          description="Coordinates are geocoded by the backend when omitted."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="City" required>
            {({ id }) => (
              <Input
                id={id}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                maxLength={120}
                placeholder="Houston"
              />
            )}
          </FormField>
          <FormField label="Time zone" required>
            {({ id }) => (
              <Input
                id={id}
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                maxLength={64}
                placeholder="America/Chicago"
              />
            )}
          </FormField>
        </div>
        <FormField label="Address">
          {({ id }) => (
            <Input
              id={id}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={300}
              placeholder="6565 Fannin St, Houston, TX"
            />
          )}
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Latitude">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                step="any"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="29.71"
              />
            )}
          </FormField>
          <FormField label="Longitude">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                step="any"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="-95.40"
              />
            )}
          </FormField>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading title="Details" />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-slate-900">
            Stay durations
          </legend>
          <div className="flex flex-wrap gap-4">
            {stayDurationOptions.map((opt) => (
              <Label key={opt.value} className="gap-2">
                <Checkbox
                  checked={stayDurations.includes(opt.value)}
                  onCheckedChange={() =>
                    setStayDurations((prev) => toggle(prev, opt.value))
                  }
                />
                {opt.label}
              </Label>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-slate-900">
            Proximity
          </legend>
          <div className="flex flex-wrap gap-4">
            {proximityTagOptions.map((opt) => (
              <Label key={opt.value} className="gap-2">
                <Checkbox
                  checked={proximityTags.includes(opt.value)}
                  onCheckedChange={() =>
                    setProximityTags((prev) => toggle(prev, opt.value))
                  }
                />
                {opt.label}
              </Label>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-slate-900">
            Special features
          </legend>
          <div className="flex flex-wrap gap-4">
            {specialFeatureOptions.map((opt) => (
              <Label key={opt.value} className="gap-2">
                <Checkbox
                  checked={specialFeatures.includes(opt.value)}
                  onCheckedChange={() =>
                    setSpecialFeatures((prev) => toggle(prev, opt.value))
                  }
                />
                {opt.label}
              </Label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Availability"
          description="Add the date ranges when the space is open for stays. Optional."
        />
        {availability.map((row, index) => (
          <div key={index} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`avail-start-${index}`}>Start</Label>
              <Input
                id={`avail-start-${index}`}
                type="date"
                value={row.startDate}
                onChange={(e) =>
                  updateAvailabilityRow(index, "startDate", e.target.value)
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`avail-end-${index}`}>End</Label>
              <Input
                id={`avail-end-${index}`}
                type="date"
                min={row.startDate || undefined}
                value={row.endDate}
                onChange={(e) =>
                  updateAvailabilityRow(index, "endDate", e.target.value)
                }
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setAvailability((rows) => rows.filter((_, i) => i !== index))
              }
              aria-label={`Remove availability window ${index + 1}`}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setAvailability((rows) => [
                ...rows,
                { startDate: "", endDate: "" },
              ])
            }
          >
            <Plus aria-hidden="true" />
            Add availability window
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Neighborhood"
          description="One item per line. Optional. The backend resolves map links."
        />
        <FormField label="Neighborhood perks">
          {({ id }) => (
            <textarea
              id={id}
              rows={3}
              value={neighborhoodPerks}
              onChange={(e) => setNeighborhoodPerks(e.target.value)}
              placeholder={"Texas Medical Center\nHermann Park"}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          )}
        </FormField>
        <FormField label="Local recommendations">
          {({ id }) => (
            <textarea
              id={id}
              rows={3}
              value={localRecommendations}
              onChange={(e) => setLocalRecommendations(e.target.value)}
              placeholder={"Local coffee shop\nGrocery store"}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          )}
        </FormField>
      </section>

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
