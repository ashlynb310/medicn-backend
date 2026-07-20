export interface PublicListingLocationDto {
  city: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  precision: "approximate";
}

export interface ExactListingLocationDto {
  address: string;
  latitude: number | null;
  longitude: number | null;
}
