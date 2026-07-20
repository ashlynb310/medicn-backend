import type { IdentityVerificationStatus } from "@prisma/client";

export interface CreateIdentitySessionInput {
  vendorData: string;
  endUserId: string;
  callbackUrl: string;
}

export interface CreatedIdentitySession {
  providerSessionId: string;
  hostedUrl: string;
  providerStatus: string;
  expiresAt: Date | null;
}

export interface NormalizedIdentityWebhook {
  sessionId: string;
  attemptId: string | null;
  vendorData: string | null;
  endUserId: string | null;
  providerStatus: string;
  providerCode: string | null;
  reasonCode: string | null;
  reasonCategory: string | null;
  occurredAt: Date | null;
  submittedAt: Date | null;
  normalizedStatus: IdentityVerificationStatus | null;
  payload: Record<string, string | null>;
}

export interface IdentityVerificationProvider {
  createSession(input: CreateIdentitySessionInput): Promise<CreatedIdentitySession>;
  verifyAndNormalizeWebhook(
    kind: "event" | "decision",
    rawBody: Buffer,
    authClient: string | undefined,
    signature: string | undefined
  ): NormalizedIdentityWebhook;
}
