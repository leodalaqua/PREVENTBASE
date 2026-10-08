import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { config } from "./config.js";
import { AllExceptionsFilter, log } from "./core/http.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["error", "warn"], bodyParser: false });
  app.set("trust proxy", true);
  app.useBodyParser("json", { limit: "12mb" });
  app.useBodyParser("urlencoded", { extended: true, limit: "1mb" });
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle("PreventBase API").setDescription("Hub de SST — /api/v1. eSocial somente leitura.").setVersion("1.0").addBearerAuth().build(),
  );
  SwaggerModule.setup("api/v1/docs", app, doc);

  await app.listen(config.port, config.host);
  log("info", "api ouvindo", { host: config.host, port: config.port });
}

bootstrap().catch((err) => {
  log("error", "falha ao iniciar", { error: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
