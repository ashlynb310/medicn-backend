import { resolve } from "node:path";
import { config } from "dotenv";

if (
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ||
  process.env.RUN_REDIS_INTEGRATION_TESTS === "true"
) {
  config({ path: resolve(__dirname, "../../../.env"), quiet: true });
}
