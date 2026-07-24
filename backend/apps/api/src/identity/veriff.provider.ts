import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IdentityVerificationStatus } from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CreatedIdentitySession,
  CreateIdentitySessionInput,
  IdentityVerificationProvider,
  NormalizedIdentityWebhook
} from "./identity-provider";

const DECISION_STATUSES = new Set([
  "approved",
  "declined",
  "resubmission_requested",
  "review",
  "expired",
  "abandoned"
]);
const DECISION_CODES = new Set(["9001", "9102", "9103", "9104", "9121"]);
const EVENT_ACTIONS = new Set([
  "started",
  "submitted",
  "waiting_continued",
  "waiting_complete",
  "flow_finished",
  "flow_cancelled",
  "document_type_other_selected"
]);
const EVENT_CODES = new Set(["7001", "7002", "7007", "7008", "7009", "7010"]);

@Injectable()
export class VeriffIdentityProvider implements IdentityVerificationProvider {
  constructor(private readonly config: ConfigService) {}

  async createSession(
    input: CreateIdentitySessionInput
  ): Promise<CreatedIdentitySession> {
    const configuration = this.requiredConfiguration();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    try {
      const response = await fetch(
        `${configuration.baseUrl.replace(/\/$/, "")}/v1/sessions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-auth-client": configuration.apiKey
          },
          body: JSON.stringify({
            verification: {
              callback: input.callbackUrl,
              vendorData: input.vendorData,
              endUserId: input.endUserId
            }
          }),
          signal: controller.signal
        }
      );

      if (!response.ok) {
        throw new Error(`Veriff session request returned ${response.status}.`);
      }

      const body = (await response.json()) as unknown;
      const verification = this.record(this.record(body).verification);
      const providerSessionId = this.string(verification.id);
      const hostedUrl = this.string(verification.url);
      const providerStatus = this.string(verification.status) ?? "created";

      if (!providerSessionId || !hostedUrl) {
        throw new Error("Veriff session response was incomplete.");
      }

      return {
        providerSessionId,
        hostedUrl,
        providerStatus,
        expiresAt: null
      };
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException({
        code: "VERIFF_PROVIDER_UNAVAILABLE",
        message: "Identity verification provider is temporarily unavailable.",
        details: {}
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  verifyAndNormalizeWebhook(
    kind: "event" | "decision",
    rawBody: Buffer,
    authClient: string | undefined,
    signature: string | undefined
  ): NormalizedIdentityWebhook {
    const configuration = this.requiredConfiguration();
    if (authClient !== configuration.apiKey || !signature) {
      throw this.invalidSignature();
    }

    const expected = createHmac("sha256", configuration.sharedSecret)
      .update(rawBody)
      .digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(signature, "hex");
    } catch {
      throw this.invalidSignature();
    }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw this.invalidSignature();
    }

    let body: Record<string, unknown>;
    try {
      body = this.record(JSON.parse(rawBody.toString("utf8")));
    } catch {
      throw this.invalidSignature();
    }

    return kind === "decision"
      ? this.normalizeDecision(body)
      : this.normalizeEvent(body);
  }

  private normalizeDecision(body: Record<string, unknown>) {
    const verification = this.record(body.verification);
    const status = this.string(verification.status);
    const sessionId = this.string(verification.id);
    if (!sessionId || !status || !DECISION_STATUSES.has(status)) {
      throw this.invalidSignature();
    }
    const occurredAt = this.date(
      verification.decisionTime ?? verification.submissionTime
    );
    const submittedAt = this.date(verification.submissionTime);
    const reasonCode = this.scalarString(verification.reasonCode);
    const normalizedStatus =
      IdentityVerificationStatus[
        status as keyof typeof IdentityVerificationStatus
      ];

    return this.normalized({
      sessionId,
      attemptId: this.string(verification.attemptId),
      vendorData: this.string(verification.vendorData),
      endUserId: this.string(verification.endUserId),
      providerStatus: status,
      providerCode: this.allowlistedCode(verification.code, DECISION_CODES),
      reasonCode,
      reasonCategory: reasonCode ? "provider_reason" : null,
      occurredAt,
      submittedAt,
      normalizedStatus
    });
  }

  private normalizeEvent(body: Record<string, unknown>) {
    const sessionId = this.string(body.id);
    const action = this.string(body.action);
    if (!sessionId || !action || !EVENT_ACTIONS.has(action)) {
      throw this.invalidSignature();
    }
    const normalizedStatus =
      action === "submitted"
        ? IdentityVerificationStatus.submitted
        : action === "started"
          ? IdentityVerificationStatus.created
          : null;

    return this.normalized({
      sessionId,
      attemptId: this.string(body.attemptId),
      vendorData: this.string(body.vendorData),
      endUserId: this.string(body.endUserId),
      providerStatus: action,
      providerCode: this.allowlistedCode(body.code, EVENT_CODES),
      reasonCode: null,
      reasonCategory: null,
      occurredAt: null,
      submittedAt: null,
      normalizedStatus
    });
  }

  private normalized(
    input: Omit<NormalizedIdentityWebhook, "payload">
  ): NormalizedIdentityWebhook {
    return {
      ...input,
      payload: {
        sessionId: input.sessionId,
        attemptId: input.attemptId,
        vendorData: input.vendorData,
        endUserId: input.endUserId,
        providerStatus: input.providerStatus,
        providerCode: input.providerCode,
        reasonCode: input.reasonCode,
        reasonCategory: input.reasonCategory,
        occurredAt: input.occurredAt?.toISOString() ?? null,
        submittedAt: input.submittedAt?.toISOString() ?? null
      }
    };
  }

  private requiredConfiguration() {
    const enabled = this.config.get<boolean>("VERIFF_ENABLED") ?? false;
    const baseUrl = this.config.get<string>("VERIFF_API_BASE_URL");
    const apiKey = this.config.get<string>("VERIFF_API_KEY");
    const sharedSecret = this.config.get<string>("VERIFF_SHARED_SECRET");
    const callbackUrl = this.config.get<string>("VERIFF_CALLBACK_URL");
    if (!enabled || !baseUrl || !apiKey || !sharedSecret || !callbackUrl) {
      throw new ServiceUnavailableException({
        code: "VERIFF_NOT_CONFIGURED",
        message: "Identity verification is not configured.",
        details: {}
      });
    }
    return { baseUrl, apiKey, sharedSecret, callbackUrl };
  }

  callbackUrl() {
    return this.requiredConfiguration().callbackUrl;
  }

  private invalidSignature() {
    return new UnauthorizedException({
      code: "INVALID_VERIFF_SIGNATURE",
      message: "Veriff webhook authentication failed.",
      details: {}
    });
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private string(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private scalarString(value: unknown) {
    return typeof value === "string" || typeof value === "number"
      ? String(value)
      : null;
  }

  private allowlistedCode(value: unknown, allowed: Set<string>) {
    const code = this.scalarString(value);
    return code && allowed.has(code) ? code : null;
  }

  private date(value: unknown) {
    if (typeof value !== "string") return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
