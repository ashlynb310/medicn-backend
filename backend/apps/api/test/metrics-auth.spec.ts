import { UnauthorizedException } from "@nestjs/common";
import { assertMetricsAuthorization } from "../src/metrics/metrics.controller";

describe("metrics authentication", () => {
  it("accepts only the exact bearer token", () => {
    const token = "metrics-" + "x".repeat(40);
    expect(() => assertMetricsAuthorization(`Bearer ${token}`, token)).not.toThrow();
    expect(() => assertMetricsAuthorization(`Bearer ${token}-wrong`, token)).toThrow(UnauthorizedException);
    expect(() => assertMetricsAuthorization(undefined, token)).toThrow(UnauthorizedException);
  });
});
