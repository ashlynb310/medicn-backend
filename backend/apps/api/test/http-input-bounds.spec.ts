import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ListBookingsQueryDto } from "../src/bookings/dto/list-bookings-query.dto";
import { MessageBodyDto } from "../src/messaging/dto/message-body.dto";

describe("HTTP input bounds", () => {
  it("caps booking-list pagination and accepts canonical status filters", async () => {
    await expect(
      validate(plainToInstance(ListBookingsQueryDto, { page: "1", limit: "100" }))
    ).resolves.toHaveLength(0);
    await expect(
      validate(plainToInstance(ListBookingsQueryDto, { limit: "101" }))
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(plainToInstance(ListBookingsQueryDto, { status: "not-a-status" }))
    ).resolves.not.toHaveLength(0);
  });

  it("rejects a message body larger than the transport-compatible ceiling", async () => {
    await expect(
      validate(
        plainToInstance(MessageBodyDto, { message: "x".repeat(8_001) })
      )
    ).resolves.not.toHaveLength(0);
  });
});
