import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureHttpApplication } from "./common/http/configure-http-application";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bodyParser: false
  });
  const socketAdapter = configureHttpApplication(app);
  if (!socketAdapter) throw new Error("Socket adapter configuration failed.");
  await socketAdapter.connectToRedis();

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap().catch(() => {
  process.stderr.write("api_startup_failed\n");
  process.exitCode = 1;
});
