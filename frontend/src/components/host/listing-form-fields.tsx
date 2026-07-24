"use client";

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import FormField from "@/components/form/form-field";
import SectionHeading from "@/components/layout/section-heading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import AddressAutocomplete from "@/components/maps/address-autocomplete";
import TimezoneSelect from "@/components/host/timezone-select";
import type {
  ProximityTag,
  SpecialFeature,
  StayDuration,
} from "@/lib/api/types";

export interface ListingFormValues {
  title: string;
  description: string;
  city: string;
  timeZone: string;
  checkoutTime: string;
  address: string;
  placeId: string | null;
  price: string;
  priceUnit: string;
  listingType: string;
  category: string;
  stayDurations: StayDuration[];
  proximityTags: ProximityTag[];
  specialFeatures: SpecialFeature[];
  neighborhoodPerks: string;
  localRecommendations: string;
}

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

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

// Shared, controlled listing fields for both create and edit. Deliberately has
// NO latitude/longitude inputs (backend rejects them) and NO availability editor
// (managed after create via the dedicated calendar endpoints).
export default function ListingFormFields({
  values,
  onChange,
}: {
  values: ListingFormValues;
  onChange: (patch: Partial<ListingFormValues>) => void;
}) {
  return (
    <>
      <section className="flex flex-col gap-4">
        <SectionHeading title="Basics" />
        <FormField label="Listing title" required>
          {({ id }) => (
            <Input
              id={id}
              value={values.title}
              onChange={(e) => onChange({ title: e.target.value })}
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
              value={values.description}
              onChange={(e) => onChange({ description: e.target.value })}
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
                value={values.listingType}
                onValueChange={(v) => onChange({ listingType: v ?? "private_room" })}
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
                value={values.category}
                onChange={(e) => onChange({ category: e.target.value })}
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
                  value={values.price}
                  onChange={(e) => onChange({ price: e.target.value })}
                  placeholder="120"
                />
              )}
            </FormField>
            <FormField label="Unit" required>
              {({ id }) => (
                <Select
                  items={priceUnitItems}
                  value={values.priceUnit}
                  onValueChange={(v) => onChange({ priceUnit: v ?? "night" })}
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
          title="Location and schedule"
          description="MediCN verifies the address and resolves the exact location. The public map shows only an approximate area."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="City" required>
            {({ id }) => (
              <Input
                id={id}
                value={values.city}
                onChange={(e) => onChange({ city: e.target.value })}
                maxLength={120}
                placeholder="Houston"
              />
            )}
          </FormField>
          <FormField
            label="Time zone"
            required
            hint="Suggested from your browser — confirm it matches the property."
          >
            {({ id, describedBy }) => (
              <TimezoneSelect
                id={id}
                value={values.timeZone}
                onChange={(timeZone) => onChange({ timeZone })}
                ariaDescribedBy={describedBy}
              />
            )}
          </FormField>
        </div>
        <FormField label="Address">
          {({ id, describedBy }) => (
            <AddressAutocomplete
              id={id}
              value={values.address}
              onChange={({ address, placeId }) => onChange({ address, placeId })}
              placeholder="6565 Fannin St, Houston, TX"
              ariaDescribedBy={describedBy}
            />
          )}
        </FormField>
        <FormField
          label="Check-out time"
          required
          hint="Local time guests must check out by. Defaults to 11:00."
        >
          {({ id }) => (
            <Input
              id={id}
              type="time"
              step={60}
              value={values.checkoutTime}
              onChange={(e) => onChange({ checkoutTime: e.target.value })}
              className="sm:max-w-40"
            />
          )}
        </FormField>
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
                  checked={values.stayDurations.includes(opt.value)}
                  onCheckedChange={() =>
                    onChange({
                      stayDurations: toggle(values.stayDurations, opt.value),
                    })
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
                  checked={values.proximityTags.includes(opt.value)}
                  onCheckedChange={() =>
                    onChange({
                      proximityTags: toggle(values.proximityTags, opt.value),
                    })
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
                  checked={values.specialFeatures.includes(opt.value)}
                  onCheckedChange={() =>
                    onChange({
                      specialFeatures: toggle(values.specialFeatures, opt.value),
                    })
                  }
                />
                {opt.label}
              </Label>
            ))}
          </div>
        </fieldset>
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
              value={values.neighborhoodPerks}
              onChange={(e) => onChange({ neighborhoodPerks: e.target.value })}
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
              value={values.localRecommendations}
              onChange={(e) => onChange({ localRecommendations: e.target.value })}
              placeholder={"Local coffee shop\nGrocery store"}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          )}
        </FormField>
      </section>
    </>
  );
}
