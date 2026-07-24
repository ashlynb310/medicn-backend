import { createHash, createHmac } from "node:crypto";
import type { Coordinates } from "./maps.types";

const EARTH_RADIUS_METERS = 6_371_000;

export function normalizeAddress(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function addressFingerprint(value: string) {
  return createHash("sha256")
    .update(normalizeAddress(value).toLocaleLowerCase("en-US"))
    .digest("hex");
}

export function isValidCoordinates(value: Coordinates) {
  return Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    value.latitude >= -90 && value.latitude <= 90 &&
    value.longitude >= -180 && value.longitude <= 180;
}

export function haversineDistanceMeters(a: Coordinates, b: Coordinates) {
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(normalizeLongitude(b.longitude - a.longitude));
  const latitudeA = radians(a.latitude);
  const latitudeB = radians(b.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function roundPublicDistance(value: number | null, roundingMeters: number) {
  if (value === null) return null;
  return Math.max(0, Math.round(value / roundingMeters) * roundingMeters);
}

export function stableApproximateCoordinates(input: Coordinates & {
  listingId: string;
  fingerprint: string;
  secret: string;
}) {
  const digest = createHmac("sha256", input.secret)
    .update(`${input.listingId}:${input.fingerprint}`)
    .digest();
  const bearing = digest.readUInt32BE(0) / 0xffffffff * Math.PI * 2;
  const distanceMeters = 300 + digest.readUInt16BE(4) / 0xffff * 150;
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const latitude = radians(input.latitude);
  const longitude = radians(input.longitude);
  const displacedLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
    Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const displacedLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(displacedLatitude)
  );
  return {
    latitude: degrees(displacedLatitude),
    longitude: normalizeLongitude(degrees(displacedLongitude))
  };
}

function radians(value: number) { return value * Math.PI / 180; }
function degrees(value: number) { return value * 180 / Math.PI; }
function normalizeLongitude(value: number) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}
