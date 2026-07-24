"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { isGoogleMapsConfigured } from "@/lib/maps/config";
import { importMapsLibrary } from "@/lib/maps/loader";

// Minimal typing for just the Places API (New) surface we use.
interface GmpPlace {
  formattedAddress?: string | null;
  id?: string | null;
  fetchFields: (options: { fields: string[] }) => Promise<unknown>;
}
interface GmpPlacePrediction {
  toPlace: () => GmpPlace;
}
interface GmpSelectEvent extends Event {
  placePrediction?: GmpPlacePrediction;
}
type PlaceAutocompleteElementCtor = new (
  options?: Record<string, unknown>
) => HTMLElement;
interface PlacesLibrary {
  PlaceAutocompleteElement?: PlaceAutocompleteElementCtor;
}

export interface AddressSelection {
  address: string;
  placeId: string | null;
}

// Accessible address input. When the browser Maps key is configured it mounts a
// Places API (New) PlaceAutocompleteElement and, on selection, fetches ONLY the
// formatted address and place id. Otherwise it stays a plain, labeled text input
// (manual fallback). The backend resolves authoritative coordinates from the
// address/placeId — the browser never requests or submits latitude/longitude.
export default function AddressAutocomplete({
  id,
  value,
  onChange,
  placeholder,
  required,
  ariaDescribedBy,
  ariaLabel = "Address",
}: {
  id: string;
  value: string;
  onChange: (next: AddressSelection) => void;
  placeholder?: string;
  required?: boolean;
  ariaDescribedBy?: string;
  ariaLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // "manual" is both the initial state and the graceful fallback.
  const [mode, setMode] = useState<"manual" | "loading" | "autocomplete">(
    isGoogleMapsConfigured() ? "loading" : "manual"
  );
  const [providerError, setProviderError] = useState<string | null>(null);
  const providerErrorId = `${id}-maps-error`;
  const manualDescribedBy = [
    ariaDescribedBy,
    providerError ? providerErrorId : null,
  ]
    .filter(Boolean)
    .join(" ") || undefined;

  useEffect(() => {
    if (!isGoogleMapsConfigured()) {
      return;
    }
    let cancelled = false;
    let element: HTMLElement | null = null;
    let handler: ((event: Event) => void) | null = null;

    const switchToManualFallback = (message: string) => {
      if (cancelled) return;
      if (element && handler) {
        element.removeEventListener("gmp-select", handler);
      }
      element?.remove();
      element = null;
      handler = null;
      setProviderError(message);
      setMode("manual");
    };

    importMapsLibrary<PlacesLibrary>("places")
      .then((places) => {
        if (cancelled || !containerRef.current) return;
        const Ctor = places.PlaceAutocompleteElement;
        if (!Ctor) {
          switchToManualFallback(
            "Address suggestions are unavailable. Enter the full address manually."
          );
          return;
        }
        element = new Ctor();
        element.id = id;
        element.setAttribute("aria-label", ariaLabel);
        if (ariaDescribedBy) {
          element.setAttribute("aria-describedby", ariaDescribedBy);
        }
        if (placeholder) {
          element.setAttribute("placeholder", placeholder);
        }
        if (required) {
          element.setAttribute("required", "");
        }
        element.style.width = "100%";

        handler = (event: Event) => {
          const prediction = (event as GmpSelectEvent).placePrediction;
          if (!prediction) return;
          const place = prediction.toPlace();
          void (async () => {
            try {
              await place.fetchFields({ fields: ["formattedAddress", "id"] });
              if (cancelled) return;
              setProviderError(null);
              onChangeRef.current({
                address: place.formattedAddress ?? "",
                placeId: place.id ?? null,
              });
            } catch {
              switchToManualFallback(
                "We could not load that address. Enter the full address manually."
              );
            }
          })();
        };
        element.addEventListener("gmp-select", handler);
        containerRef.current.appendChild(element);
        setMode("autocomplete");
      })
      .catch(() => {
        // Missing key, offline, or referrer-restricted key: manual fallback.
        switchToManualFallback(
          "Address suggestions are unavailable. Enter the full address manually."
        );
      });

    return () => {
      cancelled = true;
      if (element && handler) element.removeEventListener("gmp-select", handler);
      element?.remove();
    };
  }, [ariaDescribedBy, ariaLabel, id, placeholder, required]);

  return (
    <div className="flex flex-col gap-1">
      {/* Host for the Places element (autocomplete) — empty in manual mode. */}
      <div ref={containerRef} />
      {mode !== "autocomplete" && (
        <Input
          id={id}
          value={value}
          // Typing here is the manual fallback; it never carries a placeId.
          onChange={(e) => {
            setProviderError(null);
            onChange({ address: e.target.value, placeId: null });
          }}
          placeholder={placeholder}
          required={required}
          maxLength={300}
          autoComplete="off"
          aria-describedby={manualDescribedBy}
        />
      )}
      {providerError && (
        <p id={providerErrorId} className="text-xs text-red-700" role="alert">
          {providerError}
        </p>
      )}
      {mode === "autocomplete" && value && (
        <p className="text-xs text-slate-600">Selected: {value}</p>
      )}
      {mode === "manual" && (
        <p className="text-xs text-slate-500">
          Enter the full address. MediCN verifies and geocodes it after you
          submit.
        </p>
      )}
      {mode === "autocomplete" && (
        <p className="text-xs text-slate-500">
          Start typing and pick your address from the suggestions.
        </p>
      )}
    </div>
  );
}
