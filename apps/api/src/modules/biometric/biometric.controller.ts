import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { biometricChallengeSchema, biometricEnrollSchema, biometricFramesSchema, cancelSchema } from "@preventbase/contracts";
import type { z } from "zod";
import { config } from "../../config.js";
import { AuditService } from "../../core/audit.service.js";
import { RequirePermissions, RequireTrustedDevice } from "../../core/auth.guard.js";
import { assertCompanyAccess, authed, DomainError, notFound } from "../../core/context.js";
import { log, zod } from "../../core/http.js";
import { PrismaService } from "../../core/prisma.service.js";

interface ChallengeResponse {
  challenge_id: string;
  action: string;
  instruction: string;
  frame_count: number;
  expires_at: string;
}
interface EnrollResponse {
  profile_id: string;
  quality: number;
  liveness: boolean;
  reason?: string | null;
}
interface VerifyResponse {
  verification_id: string;
  verified: boolean;
  score: number;
  liveness: boolean;
  challenge_action: string | null;
  reason?: string | null;
}

/** Cliente do biometric-service (rede interna). Template nunca trafega para cá (§8). */
async function bio<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.biometric.url}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-service-token": config.biometric.token },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    log("error", "biometric-service indisponível", { error: err instanceof Error ? err.message : String(err) });
    throw new DomainError(503, "BIOMETRIC_UNAVAILABLE", "Serviço de biometria indisponível");
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "Falha na biometria";
    throw new DomainError(res.status >= 500 ? 502 : 422, "BIOMETRIC_ERROR", detail);
  }
  return data as T;
}

export async function biometricHealth(): Promise<boolean> {
  try {
    const r = await fetch(`${config.biometric.url}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

@Controller("biometrics")
export class BiometricController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async employee(id: string) {
    const { tenantId } = authed();
    const e = await this.prisma.employee.findFirst({ where: { id, tenantId } });
    if (!e) throw notFound("Colaborador");
    assertCompanyAccess(e.companyId);
    if (e.status !== "ACTIVE") throw new DomainError(422, "EMPLOYEE_INACTIVE", "Colaborador não está ativo");
    return e;
  }

  @Get("profiles/:employeeId")
  @RequirePermissions("employee.view")
  async profile(@Param("employeeId") employeeId: string) {
    const { tenantId } = authed();
    const profiles = await this.prisma.biometricProfile.findMany({
      where: { tenantId, employeeId },
      select: { id: true, status: true, quality: true, enrolledAt: true, revokedAt: true, revocationReason: true, legalBasis: true, purpose: true },
      orderBy: { enrolledAt: "desc" },
    });
    return { active: profiles.find((p) => p.status === "ACTIVE") ?? null, history: profiles };
  }

  /** Desafio de prova de vida de uso único (anti-replay). */
  @Post("challenge")
  @RequirePermissions("biometric.verify")
  @RequireTrustedDevice()
  async challenge(@Body(zod(biometricChallengeSchema)) body: z.infer<typeof biometricChallengeSchema>) {
    const { tenantId, permissions } = authed();
    if (body.purpose === "ENROLL" && !permissions.has("biometric.enroll")) throw new DomainError(403, "FORBIDDEN", "Permissão necessária: biometric.enroll");
    await this.employee(body.employeeId);
    const r = await bio<ChallengeResponse>("POST", "/v1/challenges", { subject_ref: body.employeeId, tenant_ref: tenantId, purpose: body.purpose });
    return { challengeId: r.challenge_id, action: r.action, instruction: r.instruction, frameCount: r.frame_count, expiresAt: r.expires_at };
  }

  @Post("enroll")
  @RequirePermissions("biometric.enroll")
  @RequireTrustedDevice()
  async enroll(@Body(zod(biometricEnrollSchema)) body: z.infer<typeof biometricEnrollSchema>) {
    const c = authed();
    const employee = await this.employee(body.employeeId);
    const r = await bio<EnrollResponse>("POST", "/v1/enroll", { subject_ref: employee.id, tenant_ref: c.tenantId, challenge_id: body.challengeId, frames: body.frames });
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.biometricProfile.findMany({ where: { tenantId: c.tenantId, employeeId: employee.id, status: "ACTIVE" } });
      for (const p of previous) {
        await tx.biometricProfile.update({ where: { id: p.id }, data: { status: "CANCELLED", revokedAt: new Date(), revokedById: c.userId, revocationReason: "Substituído por novo cadastro" } });
      }
      const profile = await tx.biometricProfile.create({
        data: {
          tenantId: c.tenantId,
          employeeId: employee.id,
          externalProfileId: r.profile_id,
          quality: r.quality,
          purpose: "Comprovação de recebimento de EPI (NR-6)",
          legalBasis: body.legalBasis,
          enrolledById: c.userId,
          deviceId: c.deviceId ?? null,
        },
      });
      await this.audit.record(tx, { action: "biometric.enrolled", entityType: "BiometricProfile", entityId: profile.id, after: { employeeId: employee.id, quality: r.quality, liveness: r.liveness, replaced: previous.length } });
      return { id: profile.id, quality: r.quality, liveness: r.liveness, enrolledAt: profile.enrolledAt };
    });
  }

  /** Verificação 1:1 + liveness. O resultado (não a imagem) é registrado e consumido uma única vez pela entrega. */
  @Post("verify")
  @RequirePermissions("biometric.verify")
  @RequireTrustedDevice()
  async verify(@Body(zod(biometricFramesSchema)) body: z.infer<typeof biometricFramesSchema>) {
    const c = authed();
    const employee = await this.employee(body.employeeId);
    const profile = await this.prisma.biometricProfile.findFirst({ where: { tenantId: c.tenantId, employeeId: employee.id, status: "ACTIVE" } });
    if (!profile) throw new DomainError(422, "NO_PROFILE", "Colaborador sem biometria cadastrada");
    const r = await bio<VerifyResponse>("POST", "/v1/verify", { subject_ref: employee.id, tenant_ref: c.tenantId, challenge_id: body.challengeId, frames: body.frames });
    const saved = await this.prisma.$transaction(async (tx) => {
      const v = await tx.biometricVerification.create({
        data: {
          tenantId: c.tenantId,
          employeeId: employee.id,
          externalVerificationId: r.verification_id,
          purpose: "DELIVERY",
          verified: r.verified,
          score: r.score,
          liveness: r.liveness,
          challengeAction: r.challenge_action,
          reason: r.reason ?? null,
          deviceId: c.deviceId ?? null,
          requestedById: c.userId,
        },
      });
      await this.audit.record(tx, {
        action: r.verified && r.liveness ? "biometric.verified" : "biometric.rejected",
        entityType: "BiometricVerification",
        entityId: v.id,
        after: { employeeId: employee.id, verified: r.verified, score: r.score, liveness: r.liveness, reason: r.reason ?? null },
      });
      return v;
    });
    return { verificationId: saved.externalVerificationId, verified: r.verified, score: r.score, liveness: r.liveness, reason: r.reason ?? null };
  }

  @Delete("profiles/:employeeId")
  @RequirePermissions("biometric.revoke")
  async revoke(@Param("employeeId") employeeId: string, @Body(zod(cancelSchema)) body: z.infer<typeof cancelSchema>) {
    const c = authed();
    const profile = await this.prisma.biometricProfile.findFirst({ where: { tenantId: c.tenantId, employeeId, status: "ACTIVE" } });
    if (!profile) throw notFound("Biometria ativa");
    await bio("DELETE", `/v1/profiles/${encodeURIComponent(employeeId)}?tenant_ref=${encodeURIComponent(c.tenantId)}`);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.biometricProfile.update({ where: { id: profile.id }, data: { status: "CANCELLED", revokedAt: new Date(), revokedById: c.userId, revocationReason: body.reason } });
      await this.audit.record(tx, { action: "biometric.revoked", entityType: "BiometricProfile", entityId: profile.id, after: { reason: body.reason } });
      return { id: updated.id, status: updated.status };
    });
  }
}
