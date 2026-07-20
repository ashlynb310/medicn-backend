import { Global, Module } from "@nestjs/common";
import {
  DistributedRateLimitService,
  RATE_LIMIT_COUNTER_STORE
} from "./distributed-rate-limit.service";
import { RedisRateLimitStore } from "./redis-rate-limit.store";

@Global()
@Module({
  providers: [
    RedisRateLimitStore,
    {
      provide: RATE_LIMIT_COUNTER_STORE,
      useExisting: RedisRateLimitStore
    },
    DistributedRateLimitService
  ],
  exports: [DistributedRateLimitService]
})
export class HttpSecurityModule {}
