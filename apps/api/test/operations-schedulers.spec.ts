import { OPERATION_SCHEDULES } from "../src/operations/operations.types";
import type { ConfigService } from "@nestjs/config";
import { OperationsQueueService } from "../src/operations/operations-queue.service";
import { OperationsService } from "../src/operations/operations.service";

describe("operations job schedulers", () => {
  it("has stable unique scheduler IDs for every recurring operation", () => {
    const ids = OPERATION_SCHEDULES.map((item) => item.schedulerId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      "medicn:stripe-webhook-retry:v1",
      "medicn:checkout-expiry:v1",
      "medicn:host-transfer-release:v1",
      "medicn:veriff-webhook-retry:v1",
      "medicn:media-recovery:v1",
      "medicn:media-cleanup:v1",
      "medicn:maps-recovery:v1",
      "medicn:maps-refresh:v1",
      "medicn:brevo-webhook-retry:v1",
      "medicn:stale-operational-recovery:v1",
      "medicn:requested-booking-expiry:v1",
      "medicn:booking-completion:v1"
    ]));
  });

  it("dispatches both lifecycle scans through the existing operations owner", async () => {
    const lifecycle = {
      expireRequestedBookings: jest.fn().mockResolvedValue({ expired: 1 }),
      completeEligibleBookings: jest.fn().mockResolvedValue({ completed: 1 })
    };
    const service = new OperationsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      lifecycle as never
    );

    await expect(service.run("requested_booking_expiry")).resolves.toEqual({ expired: 1 });
    await expect(service.run("booking_completion")).resolves.toEqual({ completed: 1 });
    expect(lifecycle.expireRequestedBookings).toHaveBeenCalledWith(100);
    expect(lifecycle.completeEligibleBookings).toHaveBeenCalledWith(100);
  });

  it("closes the scheduler queue during graceful module shutdown", async () => {
    const service = new OperationsQueueService({ get: jest.fn() } as unknown as ConfigService);
    const close = jest.fn().mockResolvedValue(undefined);
    (service as unknown as { queue: { close: typeof close } }).queue = { close };
    await service.onModuleDestroy();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
