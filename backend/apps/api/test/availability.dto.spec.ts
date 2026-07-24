import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CalendarRangeQueryDto,
  CreateAvailabilityWindowDto
} from "../src/listings/dto/availability.dto";
import { CreateListingDto } from "../src/listings/dto/create-listing.dto";
import { UpdateListingDto } from "../src/listings/dto/update-listing.dto";

describe("availability HTTP DTOs", () => {
  it("accepts only Host-managed available or blocked status", async () => {
    const reserved = plainToInstance(CreateAvailabilityWindowDto, {
      startDate: "2027-01-01",
      endDate: "2027-01-02",
      status: "reserved"
    });
    expect(await validate(reserved)).not.toHaveLength(0);
    const blocked = plainToInstance(CreateAvailabilityWindowDto, {
      startDate: "2027-01-01",
      endDate: "2027-01-02",
      status: "blocked"
    });
    expect(await validate(blocked)).toHaveLength(0);
  });

  it("rejects timestamps where a local civil date is required", async () => {
    const input = plainToInstance(CalendarRangeQueryDto, {
      startDate: "2027-03-14T00:00:00-05:00",
      endDate: "2027-03-15"
    });
    expect(await validate(input)).not.toHaveLength(0);
  });

  it("requires an explicit listing timezone field at listing creation", async () => {
    const listing = plainToInstance(CreateListingDto, {
      title: "Room",
      description: "A valid description",
      city: "Chicago",
      address: "100 Main St",
      priceCents: 9000,
      priceUnit: "day",
      listingType: "private_room"
    });
    expect((await validate(listing)).some(({ property }) => property === "timeZone"))
      .toBe(true);
  });

  it.each(["1:00", "01:0", "24:00", "11:60", "11:00:00", " 11:00 "])(
    "rejects non-canonical checkoutTime %s",
    async (checkoutTime) => {
      const input = plainToInstance(UpdateListingDto, { checkoutTime });
      expect((await validate(input)).some(({ property }) => property === "checkoutTime"))
        .toBe(true);
    }
  );

  it("accepts a canonical optional checkoutTime", async () => {
    const input = plainToInstance(UpdateListingDto, { checkoutTime: "05:07" });
    expect(await validate(input)).toHaveLength(0);
  });
});
