// Browser Maps boundary. Only NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY is ever
// read in the browser, and only for map rendering and Place Autocomplete.
// Geocoding, Nearby Search, route calculation, privacy transforms, and
// exact-location authorization belong to the backend — never the browser.
export function getGoogleMapsBrowserKey(): string | null {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY?.trim();
  return key ? key : null;
}

export function isGoogleMapsConfigured(): boolean {
  return getGoogleMapsBrowserKey() !== null;
}
