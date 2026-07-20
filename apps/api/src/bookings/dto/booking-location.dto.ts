export interface CheckInLocationDto {
  address: string;
  latitude: number | null;
  longitude: number | null;
  sourceListingLocationVersion: number | null;
  capturedAt: string | null;
}
