import { UnprocessableEntityException } from "@nestjs/common";
import { normalizeMessageBody } from "../src/messaging/message-content";

describe("messaging content rules", () => {
  it("trims only surrounding whitespace and preserves internal content", () => {
    expect(normalizeMessageBody("  Hello  there 👋  ")).toBe("Hello  there 👋");
  });

  it("counts Unicode code points rather than UTF-16 code units", () => {
    expect(normalizeMessageBody("😀".repeat(4_000))).toHaveLength(8_000);
    expect(() => normalizeMessageBody("😀".repeat(4_001))).toThrow(
      UnprocessableEntityException
    );
  });

  it("rejects empty messages with VALIDATION_ERROR", () => {
    try {
      normalizeMessageBody(" \n\t ");
      throw new Error("expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        code: "VALIDATION_ERROR"
      });
    }
  });

  it.each([
    "email me at renter@example.com",
    "call +44 20 7946 0958",
    "call (713) 555-1212",
    "call 1-713-555-1212"
  ])("rejects obvious contact information: %s", (message) => {
    try {
      normalizeMessageBody(message);
      throw new Error("expected contact-information failure");
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        code: "CONTACT_INFORMATION_NOT_ALLOWED"
      });
    }
  });
});
