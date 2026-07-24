import { ConfigService } from "@nestjs/config";
import { GoogleMapsProvider } from "../src/maps/google-maps.provider";
import { MapsProviderError } from "../src/maps/maps.types";

describe("GoogleMapsProvider", () => {
  const config = new ConfigService({
    GOOGLE_MAPS_SERVER_API_KEY: "server-secret-key",
    MAPS_PROVIDER_TIMEOUT_MS: 5000
  });
  const provider = new GoogleMapsProvider(config);

  afterEach(() => jest.restoreAllMocks());

  it("resolves an untrusted placeId through Geocoding v4 with a minimal FieldMask", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      placeId: "place_123",
      formattedAddress: "100 Main St, Houston, TX 77002, USA",
      location: { latitude: 29.75, longitude: -95.37 },
      granularity: "ROOFTOP",
      types: ["street_address"]
    }), { status: 200 }));

    await expect(provider.geocodeAddress({
      address: "100 Main St Houston TX",
      placeId: "place_123"
    })).resolves.toMatchObject({
      status: "verified",
      placeId: "place_123",
      latitude: 29.75,
      longitude: -95.37,
      precision: "rooftop"
    });

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("geocode.googleapis.com/v4/geocode/places/place_123");
    expect(String(url)).not.toContain("server-secret-key");
    expect(new Headers(options?.headers).get("X-Goog-FieldMask")).toBe(
      "placeId,formattedAddress,location,granularity,types"
    );
  });

  it("maps multiple or low-precision address results to ambiguous", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      results: [
        { placeId: "a", formattedAddress: "Houston", location: { latitude: 29, longitude: -95 }, granularity: "APPROXIMATE", types: ["locality"] },
        { placeId: "b", formattedAddress: "Houston County", location: { latitude: 31, longitude: -95 }, granularity: "APPROXIMATE", types: ["administrative_area_level_2"] }
      ]
    }), { status: 200 }));
    await expect(provider.geocodeAddress({ address: "Houston" }))
      .resolves.toEqual({ status: "ambiguous" });
  });

  it("rejects provider coordinates outside geographic bounds", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      results: [{
        placeId: "invalid",
        formattedAddress: "Invalid address",
        location: { latitude: 91, longitude: -95 },
        granularity: "ROOFTOP",
        types: ["street_address"]
      }]
    }), { status: 200 }));
    await expect(provider.geocodeAddress({ address: "Invalid address" }))
      .resolves.toEqual({ status: "not_found" });
  });

  it("uses Places API New supported types and an explicit minimal FieldMask", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      places: [{
        id: "hospital_1",
        displayName: { text: "MediCN Hospital" },
        googleMapsUri: "https://maps.google.com/?cid=1",
        location: { latitude: 29.76, longitude: -95.38 },
        types: ["hospital"]
      }]
    }), { status: 200 }));
    await expect(provider.searchNearby({
      center: { latitude: 29.75, longitude: -95.37 },
      includedTypes: ["hospital", "general_hospital", "medical_center"],
      radiusMeters: 5000,
      maxResults: 5
    })).resolves.toHaveLength(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://places.googleapis.com/v1/places:searchNearby");
    expect(new Headers(options?.headers).get("X-Goog-FieldMask")).toBe(
      "places.id,places.displayName,places.googleMapsUri,places.location,places.types"
    );
    expect(JSON.parse(String(options?.body))).toMatchObject({
      includedTypes: ["hospital", "general_hospital", "medical_center"],
      maxResultCount: 5
    });
  });

  it("tolerates individual Routes v2 matrix failures", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify([
      { originIndex: 0, destinationIndex: 0, condition: "ROUTE_EXISTS", distanceMeters: 1200, duration: "600s", status: {} },
      { originIndex: 0, destinationIndex: 1, condition: "ROUTE_NOT_FOUND", status: { code: 5 } }
    ]), { status: 200 }));
    await expect(provider.computeRouteMatrix({
      origin: { latitude: 29.75, longitude: -95.37 },
      destinations: [
        { latitude: 29.76, longitude: -95.38 },
        { latitude: 0, longitude: 0 }
      ],
      travelMode: "walking"
    })).resolves.toEqual([
      { destinationIndex: 0, distanceMeters: 1200, durationSeconds: 600 },
      { destinationIndex: 1, distanceMeters: null, durationSeconds: null }
    ]);
  });

  it("returns secret-safe provider errors", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("network down server-secret-key"));
    await expect(provider.geocodeAddress({ address: "100 Main St Houston TX" }))
      .rejects.toEqual(new MapsProviderError("unavailable", "Maps provider is unavailable."));
  });
});
