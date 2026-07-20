import { NestFactory } from "@nestjs/core";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AppModule } from "../app.module";
import { buildOpenApiDocument, stableOpenApiJson } from "./openapi-document";

async function run() {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    throw new Error("Usage: openapi-generate --write|--check");
  }
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: false
  });
  try {
    app.setGlobalPrefix("api/v1");
    const output = stableOpenApiJson(buildOpenApiDocument(app));
    const target = resolve(__dirname, "../../../../docs/openapi.json");
    if (mode === "--write") {
      await writeFile(target, output, "utf8");
      process.stdout.write(`openapi_written operations=${operationCount(JSON.parse(output))}\n`);
      return;
    }
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== output) {
      throw new Error("OpenAPI drift detected. Run npm run openapi:generate -w apps/api.");
    }
    process.stdout.write(`openapi_clean operations=${operationCount(JSON.parse(output))}\n`);
  } finally {
    await app.close();
  }
}

function operationCount(document: { paths?: Record<string, unknown> }) {
  return Object.values(document.paths ?? {}).reduce<number>((count, path) => {
    if (typeof path !== "object" || path === null) return count;
    return count + Object.keys(path).filter((method) =>
      ["get", "post", "put", "patch", "delete"].includes(method)
    ).length;
  }, 0);
}

void run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "OpenAPI generation failed."}\n`
  );
  process.exitCode = 1;
});
