import { SetMetadata } from "@nestjs/common";

export const ROUTE_AUTH_MODE = "medicn:route-auth-mode";
export type RouteAuthMode = "protected" | "optional" | "public";

export const PublicRoute = () => SetMetadata(ROUTE_AUTH_MODE, "public");
export const OptionalBearerRoute = () =>
  SetMetadata(ROUTE_AUTH_MODE, "optional");
