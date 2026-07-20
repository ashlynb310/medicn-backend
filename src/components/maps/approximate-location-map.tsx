"use client";

import { useEffect, useRef, useState } from "react";
import { isGoogleMapsConfigured } from "@/lib/maps/config";
import { importMapsLibrary } from "@/lib/maps/loader";

// Minimal typing for the Maps library surface we use.
interface GmpMap {
  fitBounds: (bounds: unknown) => void;
}
interface GmpCircle {
  getBounds: () => unknown | null;
  setMap: (map: unknown | null) => void;
}
type MapCtor = new (el: HTMLElement, options: Record<string, unknown>) => GmpMap;
type CircleCtor = new (options: Record<string, unknown>) => GmpCircle;
interface MapsLibrary {
  Map?: MapCtor;
  Circle?: CircleCtor;
}

// Renders the public APPROXIMATE area only: a circle centered on the
// backend-provided public coordinates using publicLocation.radiusMeters. It
// never renders an exact-property marker and never uses the exact location as a
// directions origin. When the browser Maps key or public coordinates are
// missing, it shows a neutral area fallback (the surrounding card carries the
// city text). Only backend publicLocation values are used.
export default function ApproximateLocationMap({
  latitude,
  longitude,
  radiusMeters,
  city,
}: {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  city: string;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const canRender =
    isGoogleMapsConfigured() && latitude !== null && longitude !== null;
  const locationSignature = canRender
    ? `${latitude}:${longitude}:${radiusMeters}`
    : null;
  const [result, setResult] = useState<{
    signature: string;
    status: "ready" | "fallback";
  } | null>(null);
  const mode = !locationSignature
    ? "fallback"
    : result?.signature === locationSignature
      ? result.status
      : "loading";

  useEffect(() => {
    if (
      !canRender ||
      latitude === null ||
      longitude === null ||
      !locationSignature
    ) {
      return;
    }
    let cancelled = false;
    let circle: GmpCircle | null = null;

    importMapsLibrary<MapsLibrary>("maps")
      .then((lib) => {
        if (cancelled || !mapRef.current) return;
        if (!lib.Map || !lib.Circle) {
          setResult({ signature: locationSignature, status: "fallback" });
          return;
        }
        const center = { lat: latitude, lng: longitude };
        const map = new lib.Map(mapRef.current, {
          center,
          zoom: 13,
          disableDefaultUI: true,
          gestureHandling: "cooperative",
          clickableIcons: false,
          keyboardShortcuts: false,
        });
        circle = new lib.Circle({
          map,
          center,
          radius: radiusMeters > 0 ? radiusMeters : 800,
          fillColor: "#0284c7",
          fillOpacity: 0.15,
          strokeColor: "#0284c7",
          strokeOpacity: 0.4,
          strokeWeight: 1,
          clickable: false,
        });
        const bounds = circle.getBounds?.();
        if (bounds) map.fitBounds(bounds);
        setResult({ signature: locationSignature, status: "ready" });
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ signature: locationSignature, status: "fallback" });
        }
      });

    return () => {
      cancelled = true;
      circle?.setMap(null);
    };
  }, [canRender, latitude, longitude, locationSignature, radiusMeters]);

  if (mode === "fallback") {
    return (
      <div
        className="flex h-40 w-full items-center justify-center rounded-lg bg-sky-50 text-center"
        role="img"
        aria-label={`Approximate area in ${city || "the listed city"}. A precise map is not available.`}
      >
        <div className="size-24 rounded-full bg-sky-500/15" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div
      ref={mapRef}
      className="h-40 w-full overflow-hidden rounded-lg bg-sky-50"
      role="img"
      aria-label={`Approximate area in ${city || "the listed city"}`}
    />
  );
}
