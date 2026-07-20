import { ForbiddenException, Injectable } from "@nestjs/common";
import {
  IdentityVerificationStatus,
  type Prisma
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

type IdentityClient = Pick<Prisma.TransactionClient, "identityVerification">;

@Injectable()
export class IdentityEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async assertApproved(userId: string, client: IdentityClient = this.prisma) {
    const current = await client.identityVerification.findFirst({
      where: { userId, supersededAt: null },
      select: { status: true }
    });

    if (current?.status === IdentityVerificationStatus.approved) return;

    const status = current?.status;
    if (status === IdentityVerificationStatus.expired) {
      throw this.exception(
        "IDENTITY_VERIFICATION_EXPIRED",
        "Identity verification has expired."
      );
    }
    if (
      status === IdentityVerificationStatus.declined ||
      status === IdentityVerificationStatus.abandoned
    ) {
      throw this.exception(
        "IDENTITY_VERIFICATION_REJECTED",
        "Identity verification must be retried before continuing."
      );
    }
    if (
      status === IdentityVerificationStatus.created ||
      status === IdentityVerificationStatus.submitted ||
      status === IdentityVerificationStatus.review ||
      status === IdentityVerificationStatus.resubmission_requested
    ) {
      throw this.exception(
        "IDENTITY_VERIFICATION_PENDING",
        "Identity verification is still pending."
      );
    }
    throw this.exception(
      "IDENTITY_VERIFICATION_REQUIRED",
      "Identity verification is required."
    );
  }

  private exception(code: string, message: string) {
    return new ForbiddenException({ code, message, details: {} });
  }
}
