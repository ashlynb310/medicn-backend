import {
  addressFingerprint,
  haversineDistanceMeters,
  normalizeAddress,
  roundPublicDistance,
  stableApproximateCoordinates
} from "../src/maps/geo";

describe("location geographic utilities", () => {
  it("normalizes address whitespace and fingerprints equivalent input equally", () => {
    expect(normalizeAddress(" 100   Main St,\n Houston  ")).toBe("100 Main St, Houston");
    expect(addressFingerprint("100 Main St, Houston"))
      .toBe(addressFingerprint("  100  main ST, Houston "));
  });

  it("generates stable displaced approximate coordinates per address version", () => {
    const first = stableApproximateCoordinates({
      latitude: 29.75,
      longitude: -95.37,
      listingId: "listing_1",
      fingerprint: "fingerprint-a",
      secret: "development-secret"
    });
    const again = stableApproximateCoordinates({
      latitude: 29.75,
      longitude: -95.37,
      listingId: "listing_1",
      fingerprint: "fingerprint-a",
      secret: "development-secret"
    });
    expect(again).toEqual(first);
    expect(haversineDistanceMeters({ latitude: 29.75, longitude: -95.37 }, first))
      .toBeGreaterThanOrEqual(299);
    expect(haversineDistanceMeters({ latitude: 29.75, longitude: -95.37 }, first))
      .toBeLessThanOrEqual(451);
    expect(stableApproximateCoordinates({
      latitude: 29.75,
      longitude: -95.37,
      listingId: "listing_1",
      fingerprint: "fingerprint-b",
      secret: "development-secret"
    })).not.toEqual(first);
  });

  it("calculates Haversine distance across the antimeridian", () => {
    const distance = haversineDistanceMeters(
      { latitude: 0, longitude: 179.9 },
      { latitude: 0, longitude: -179.9 }
    );
    expect(distance).toBeGreaterThan(22_000);
    expect(distance).toBeLessThan(22_300);
  });

  it("rounds public distances without adding precision", () => {
    expect(roundPublicDistance(1249, 100)).toBe(1200);
    expect(roundPublicDistance(null, 100)).toBeNull();
  });
});
