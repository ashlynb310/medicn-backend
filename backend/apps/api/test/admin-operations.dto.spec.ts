import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  ListJobExecutionsQueryDto,
  ListPaymentsQueryDto,
  RequeueJobExecutionDto,
  ReconcilePaymentsDto
} from "../src/admin/dto/operations.dto";

describe("Admin operations DTO validation", () => {
  it("enforces bounded pagination and canonical filters", async () => {
    const query = plainToInstance(ListPaymentsQueryDto, {
      page: "1",
      limit: "101",
      status: "paid",
      bookingId: "not-a-uuid",
      createdFrom: "yesterday"
    });
    const errors = await validate(query);
    expect(errors.map(({ property }) => property).sort()).toEqual([
      "bookingId",
      "createdFrom",
      "limit"
    ]);
  });

  it("rejects unknown queue names and unbounded operation types", async () => {
    const query = plainToInstance(ListJobExecutionsQueryDto, {
      queueName: "attacker_queue",
      jobType: "x".repeat(101),
      page: "1",
      limit: "20"
    });
    const errors = await validate(query);
    expect(errors.map(({ property }) => property).sort()).toEqual([
      "jobType",
      "queueName"
    ]);
  });

  it("requires a bounded idempotency key and audited reason for requeue", async () => {
    const body = plainToInstance(RequeueJobExecutionDto, {
      idempotencyKey: "short",
      reason: "x",
      payload: { queueName: "operations" }
    });
    const errors = await validate(body, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map(({ property }) => property).sort()).toEqual([
      "idempotencyKey",
      "payload",
      "reason"
    ]);
  });

  it("caps reconciliation and accepts a single payment selector", async () => {
    const invalid = plainToInstance(ReconcilePaymentsDto, {
      idempotencyKey: "reconcile:payment:test-1",
      reason: "Verify a stale payment after a missed webhook.",
      paymentId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      limit: 26,
      staleBefore: "2026-07-19T12:00:00.000Z"
    });
    await expect(validate(invalid)).resolves.toEqual([
      expect.objectContaining({ property: "limit" })
    ]);

    invalid.limit = 1;
    await expect(validate(invalid)).resolves.toHaveLength(0);
  });
});
