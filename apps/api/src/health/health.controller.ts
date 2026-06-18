import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  getHealth() {
    return {
      service: "medicn-api",
      status: "ok",
      timestamp: new Date().toISOString()
    };
  }
}
