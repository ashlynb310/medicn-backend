"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ListingSort,
  ListingType,
  SearchListingsParams,
  StayDuration,
} from "@/lib/api/types";

const ANY = "any";

const listingTypeItems: Record<string, string> = {
  [ANY]: "Any type",
  private_room: "Private room",
  entire_home: "Entire home",
  shared_room: "Shared room",
};

const stayDurationItems: Record<string, string> = {
  [ANY]: "Any duration",
  short_term: "Short term",
  medium_term: "Medium term",
  long_term: "Long term",
};

const sortItems: Record<string, string> = {
  newest: "Newest",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
};

interface ListingSearchFiltersProps {
  initialFilters: SearchListingsParams;
}

function FilterSelect({
  id,
  label,
  items,
  value,
  onChange,
}: {
  id: string;
  label: string;
  items: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => onChange(next ?? ANY)}
      >
        <SelectTrigger id={id} className="w-full bg-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(items).map(([itemValue, itemLabel]) => (
            <SelectItem key={itemValue} value={itemValue}>
              {itemLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function ListingSearchFilters({
  initialFilters,
}: ListingSearchFiltersProps) {
  const router = useRouter();

  const [location, setLocation] = useState(initialFilters.location ?? "");
  const [listingType, setListingType] = useState<string>(
    initialFilters.listingType ?? ANY
  );
  const [stayDuration, setStayDuration] = useState<string>(
    initialFilters.stayDuration ?? ANY
  );
  const [minPrice, setMinPrice] = useState(
    initialFilters.minPrice !== undefined ? String(initialFilters.minPrice) : ""
  );
  const [maxPrice, setMaxPrice] = useState(
    initialFilters.maxPrice !== undefined ? String(initialFilters.maxPrice) : ""
  );
  const [startDate, setStartDate] = useState(initialFilters.startDate ?? "");
  const [endDate, setEndDate] = useState(initialFilters.endDate ?? "");
  const [sort, setSort] = useState<string>(initialFilters.sort ?? "newest");
  const [validationError, setValidationError] = useState<string | null>(null);

  const applyFilters = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if ((startDate && !endDate) || (!startDate && endDate)) {
      setValidationError(
        "Select both a start date and an end date to filter by availability."
      );
      return;
    }
    if (startDate && endDate && endDate <= startDate) {
      setValidationError("The end date must be after the start date.");
      return;
    }
    if (minPrice && maxPrice && Number(minPrice) > Number(maxPrice)) {
      setValidationError("Minimum price cannot be greater than maximum price.");
      return;
    }
    setValidationError(null);

    const params = new URLSearchParams();
    if (location.trim()) params.set("location", location.trim());
    if (listingType !== ANY)
      params.set("listingType", listingType as ListingType);
    if (stayDuration !== ANY)
      params.set("stayDuration", stayDuration as StayDuration);
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    if (startDate && endDate) {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }
    if (sort !== "newest") params.set("sort", sort as ListingSort);

    const query = params.toString();
    router.push(query ? `/search?${query}` : "/search");
  };

  const clearFilters = () => {
    setLocation("");
    setListingType(ANY);
    setStayDuration(ANY);
    setMinPrice("");
    setMaxPrice("");
    setStartDate("");
    setEndDate("");
    setSort("newest");
    setValidationError(null);
    router.push("/search");
  };

  return (
    <form
      onSubmit={applyFilters}
      aria-label="Listing search filters"
      className="rounded-xl border border-slate-200 bg-slate-50 p-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="filter-location">Location</Label>
          <Input
            id="filter-location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City, address, or listing name"
            className="bg-white"
          />
        </div>

        <FilterSelect
          id="filter-listing-type"
          label="Listing type"
          items={listingTypeItems}
          value={listingType}
          onChange={setListingType}
        />

        <FilterSelect
          id="filter-stay-duration"
          label="Stay duration"
          items={stayDurationItems}
          value={stayDuration}
          onChange={setStayDuration}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-min-price">Min price ($)</Label>
          <Input
            id="filter-min-price"
            type="number"
            min={0}
            step="1"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            placeholder="0"
            className="bg-white"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-max-price">Max price ($)</Label>
          <Input
            id="filter-max-price"
            type="number"
            min={0}
            step="1"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="Any"
            className="bg-white"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-start-date">Check in</Label>
          <Input
            id="filter-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-white"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-end-date">Check out</Label>
          <Input
            id="filter-end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-white"
          />
        </div>

        <FilterSelect
          id="filter-sort"
          label="Sort by"
          items={sortItems}
          value={sort}
          onChange={setSort}
        />
      </div>

      {validationError && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {validationError}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit">
          <Search aria-hidden="true" />
          Search listings
        </Button>
        <Button type="button" variant="ghost" onClick={clearFilters}>
          Clear filters
        </Button>
      </div>
    </form>
  );
}
