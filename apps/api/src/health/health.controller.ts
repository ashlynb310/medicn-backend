import { Controller, Get, HttpStatus, Optional, Res } from "@nestjs/common";
import { HealthService } from "./health.service";
import { PublicRoute } from "../common/http/route-auth.decorator";

@PublicRoute()
@Controller("health")
export class HealthController {
  constructor(@Optional() private readonly health?: HealthService) {}

  @Get()
  getHealth() {
    return {
      service: "medicn-api",
      status: "ok",
      timestamp: new Date().toISOString()
    };
  }

  @Get("live")
  getLive() {
    return this.getHealth();
  }

  @Get("ready")
  async getReady(
    @Res({ passthrough: true }) response: { status(code: number): unknown }
  ) {
    const result = this.health
      ? await this.health.ready()
      : {
          service: "medicn-api",
          status: "ready",
          checks: {},
          timestamp: new Date().toISOString()
        };
    response.status(
      result.status === "ready"
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE
    );
    return result;
  }
}
