import { Controller, Get, Headers, NotFoundException, Res, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, timingSafeEqual } from "node:crypto";
import { MetricsService } from "./metrics.service";
import { PublicRoute } from "../common/http/route-auth.decorator";

interface MetricsResponse {
  type(contentType: string): MetricsResponse;
  send(body: string): unknown;
}

export function assertMetricsAuthorization(authorization: string | undefined, expected: string | undefined) {
  const supplied = authorization?.match(/^Bearer ([^\s]+)$/)?.[1] ?? "";
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  const expectedDigest = createHash("sha256").update(expected ?? "").digest();
  if (!expected || !supplied || !timingSafeEqual(suppliedDigest, expectedDigest)) {
    throw new UnauthorizedException({ code: "METRICS_UNAUTHORIZED", message: "Metrics authorization failed.", details: {} });
  }
}

@Controller("metrics")
export class MetricsController {
  constructor(private readonly config: ConfigService, private readonly metrics: MetricsService) {}

  @Get()
  @PublicRoute()
  async getMetrics(@Headers("authorization") authorization: string | undefined, @Res() response: MetricsResponse) {
    if (!this.config.get<boolean>("OPERATIONS_METRICS_ENABLED")) throw new NotFoundException();
    assertMetricsAuthorization(authorization, this.config.get<string>("OPERATIONS_METRICS_TOKEN"));
    response.type(this.metrics.contentType).send(await this.metrics.render());
  }
}
