import { Test } from "@nestjs/testing";
import { HealthController } from "../src/health/health.controller";

describe("HealthController", () => {
  it("returns API health status", () => {
    const controller = new HealthController();

    expect(controller.getHealth()).toMatchObject({
      service: "medicn-api",
      status: "ok"
    });
  });

  it("can be compiled by Nest testing module", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController]
    }).compile();

    expect(moduleRef.get(HealthController)).toBeInstanceOf(HealthController);
  });
});
