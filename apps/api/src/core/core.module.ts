import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { config } from "../config.js";
import { AuditService } from "./audit.service.js";
import { AuthGuard } from "./auth.guard.js";
import { IdempotencyService } from "./idempotency.service.js";
import { PrismaService } from "./prisma.service.js";
import { QueueService } from "./queue.service.js";
import { StorageService } from "./storage.service.js";

@Global()
@Module({
  imports: [JwtModule.register({ secret: config.jwtSecret, signOptions: { expiresIn: config.accessTtlSeconds } })],
  providers: [PrismaService, AuditService, IdempotencyService, QueueService, StorageService, AuthGuard, { provide: APP_GUARD, useExisting: AuthGuard }],
  exports: [PrismaService, AuditService, IdempotencyService, QueueService, StorageService, AuthGuard, JwtModule],
})
export class CoreModule {}
