import { Injectable } from "@nestjs/common";
import { authed, ctx, DomainError } from "../../core/context.js";
import { PrismaService } from "../../core/prisma.service.js";
import { AuthService } from "./auth.service.js";
import {
  loginOptions,
  newUserHandle,
  passkeyConfig,
  PasskeyError,
  publicView,
  registrationOptions,
  verifyLogin,
  verifyRegistration,
  type PasskeyCredential,
} from "./passkey-core.js";

// Origem: web :3100 (HTTPS tailnet :13100).
const HTTPS_PORTS = [13100];
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 20;
const failures = new Map<string, number[]>();

type Row = {
  credentialId: string;
  userId: string;
  publicKey: string;
  signCount: number;
  transports: string[];
  deviceName: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

/** Login por biometria (passkey) — C:\ROBBY\docs\decisions\2026-10-09-login-passkey.md */
@Injectable()
export class PasskeyService {
  private readonly cfg = passkeyConfig("PreventBase", HTTPS_PORTS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async loginOptions() {
    assertNotBlocked(clientIp());
    return loginOptions(this.cfg);
  }

  async loginVerify(response: unknown) {
    const ip = clientIp();
    assertNotBlocked(ip);
    try {
      const { credential, newCounter } = await verifyLogin(this.cfg, response, async (id) => {
        const row = await this.prisma.webauthnCredential.findUnique({ where: { credentialId: id } });
        return row ? toCore(row) : null;
      });
      await this.prisma.webauthnCredential.update({
        where: { credentialId: credential.id },
        data: { signCount: newCounter, lastUsedAt: new Date() },
      });
      return await this.auth.loginWithPasskey(credential.userKey, credential.id);
    } catch (err) {
      failures.set(ip, [...recent(ip), Date.now()]);
      throw asDomain(err);
    }
  }

  async registerOptions() {
    const { userId } = authed();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE") throw new DomainError(401, "UNAUTHORIZED", "Usuário inválido");
    let handle = user.webauthnUserHandle;
    if (!handle) {
      handle = newUserHandle();
      await this.prisma.user.update({ where: { id: userId }, data: { webauthnUserHandle: handle } });
    }
    const existing = await this.prisma.webauthnCredential.findMany({ where: { userId } });
    return registrationOptions(this.cfg, { key: userId, handle, email: user.email, displayName: user.name }, existing.map(toCore));
  }

  async registerVerify(response: unknown, deviceName: unknown) {
    const { userId } = authed();
    try {
      const cred = await verifyRegistration(this.cfg, userId, response, String(deviceName ?? ""));
      const row = await this.prisma.webauthnCredential.create({
        data: {
          userId,
          credentialId: cred.id,
          publicKey: cred.publicKey,
          signCount: cred.counter,
          transports: cred.transports,
          deviceName: cred.deviceName,
        },
      });
      return { item: publicView(toCore(row)) };
    } catch (err) {
      throw asDomain(err);
    }
  }

  async list() {
    const rows = await this.prisma.webauthnCredential.findMany({ where: { userId: authed().userId }, orderBy: { createdAt: "asc" } });
    return { items: rows.map((r) => publicView(toCore(r))) };
  }

  async remove(credentialId: string) {
    const { count } = await this.prisma.webauthnCredential.deleteMany({ where: { userId: authed().userId, credentialId } });
    if (!count) throw new DomainError(404, "NOT_FOUND", "Biometria não encontrada.");
    return { ok: true };
  }
}

function clientIp(): string {
  return ctx().ip ?? "?";
}

function recent(ip: string): number[] {
  const now = Date.now();
  const list = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(ip, list);
  else failures.delete(ip);
  return list;
}

function assertNotBlocked(ip: string): void {
  if (recent(ip).length >= MAX_FAILURES) throw new DomainError(429, "TOO_MANY_ATTEMPTS", "Muitas tentativas. Aguarde 15 minutos.");
}

function toCore(row: Row): PasskeyCredential {
  return {
    id: row.credentialId,
    userKey: row.userId,
    publicKey: row.publicKey,
    counter: row.signCount,
    transports: row.transports,
    deviceName: row.deviceName,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

function asDomain(err: unknown): unknown {
  if (err instanceof PasskeyError) return new DomainError(err.status, err.status === 401 ? "PASSKEY_UNKNOWN" : "PASSKEY_INVALID", err.message);
  return err;
}
