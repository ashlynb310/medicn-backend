import { SetMetadata } from "@nestjs/common";
import type { RateLimitPolicyName } from "./distributed-rate-limit.service";

export const RATE_LIMIT_POLICY = "medicn:rate-limit-policy";
export const RateLimit = (policy: RateLimitPolicyName) =>
  SetMetadata(RATE_LIMIT_POLICY, policy);
