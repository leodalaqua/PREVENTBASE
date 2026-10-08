import { randomUUID } from "node:crypto";
import {
  type ArgumentMetadata,
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Injectable,
  type NestMiddleware,
  type PipeTransform,
} from "@nestjs/common";
import { Prisma } from "@preventbase/database";
import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { contextStorage, DomainError } from "./context.js";

export function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  if (level === "error") console.error(line);
  else console.log(line);
}

@Injectable()
export class ContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.header("x-request-id") ?? "").slice(0, 64) || randomUUID();
    res.setHeader("x-request-id", requestId);
    const started = process.hrtime.bigint();
    const store = {
      requestId,
      ip: req.ip,
      userAgent: req.header("user-agent")?.slice(0, 400),
      deviceKey: req.header("x-device-key")?.slice(0, 200),
    };
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const s = store as Record<string, unknown>;
      log(res.statusCode >= 500 ? "error" : "info", "request", {
        requestId,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        ms: Math.round(ms),
        userId: s.userId,
        tenantId: s.tenantId,
      });
    });
    contextStorage.run(store, () => next());
  }
}

export class ZodPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown, _meta: ArgumentMetadata): z.infer<T> {
    return this.schema.parse(value);
  }
}

export const zod = <T extends ZodTypeAny>(schema: T) => new ZodPipe(schema);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = contextStorage.getStore()?.requestId;
    const send = (status: number, code: string, message: string, details?: unknown) =>
      res.status(status).json({ statusCode: status, code, message, details, requestId });

    if (exception instanceof DomainError) return void send(exception.status, exception.code, exception.message, exception.details);
    if (exception instanceof ZodError) {
      return void send(400, "VALIDATION", exception.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), exception.issues);
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message = typeof body === "string" ? body : ((body as { message?: string | string[] }).message ?? exception.message);
      return void send(exception.getStatus(), "HTTP", Array.isArray(message) ? message.join("; ") : message);
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2002") return void send(409, "CONFLICT", "Registro duplicado", exception.meta);
      if (exception.code === "P2025") return void send(404, "NOT_FOUND", "Registro não encontrado");
      if (exception.code === "P2003") return void send(422, "FK", "Referência inválida", exception.meta);
    }
    const msg = exception instanceof Error ? exception.message : String(exception);
    if (msg.includes("PreventBase:")) return void send(409, "IMMUTABLE", msg.slice(msg.indexOf("PreventBase:")));
    log("error", "unhandled", { requestId, error: msg, stack: exception instanceof Error ? exception.stack : undefined });
    send(500, "INTERNAL", "Erro interno");
  }
}
