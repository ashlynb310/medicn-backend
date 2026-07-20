import { UnprocessableEntityException } from "@nestjs/common";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const NORTH_AMERICAN_PHONE_PATTERN =
  /(?:\+?1[\s().-]*)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}\b/u;
const INTERNATIONAL_PHONE_PATTERN =
  /(?:\+|00)\s*\d(?:[\s().-]*\d){7,14}\b/u;

export function normalizeMessageBody(raw: string) {
  const message = raw.trim();

  if (message.length === 0) {
    throw new UnprocessableEntityException({
      code: "VALIDATION_ERROR",
      message: "Message must not be empty.",
      details: { field: "message" }
    });
  }

  if ([...message].length > 4_000) {
    throw new UnprocessableEntityException({
      code: "VALIDATION_ERROR",
      message: "Message must not exceed 4,000 Unicode code points.",
      details: { field: "message", maximumCodePoints: 4_000 }
    });
  }

  if (
    EMAIL_PATTERN.test(message) ||
    NORTH_AMERICAN_PHONE_PATTERN.test(message) ||
    INTERNATIONAL_PHONE_PATTERN.test(message)
  ) {
    throw new UnprocessableEntityException({
      code: "CONTACT_INFORMATION_NOT_ALLOWED",
      message: "Contact information is not allowed in inquiry messages.",
      details: {}
    });
  }

  return message;
}
