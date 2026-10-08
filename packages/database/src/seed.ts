import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_DELIVERY_REASONS, DEFAULT_TERMS_TEXT } from "@preventbase/contracts";
import { PERMISSIONS, SYSTEM_ROLES } from "@preventbase/permissions";

export interface SeedOptions {
  tenantName: string;
  adminEmail: string;
  adminPassword?: string;
  log?: (msg: string) => void;
}

/** Idempotente: pode rodar a cada deploy. Só cria admin/tenant se não existirem. */
export async function runSeed(prisma: PrismaClient, opts: SeedOptions): Promise<void> {
  const log = opts.log ?? (() => undefined);

  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  }
  const permissions = await prisma.permission.findMany();
  const permId = new Map(permissions.map((p) => [p.key, p.id]));

  for (const [key, def] of Object.entries(SYSTEM_ROLES)) {
    let role = await prisma.role.findFirst({ where: { tenantId: null, key } });
    if (!role) role = await prisma.role.create({ data: { key, name: def.name, system: true } });
    else if (role.name !== def.name) role = await prisma.role.update({ where: { id: role.id }, data: { name: def.name } });
    const roleId = role.id;
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.rolePermission.createMany({
      data: def.permissions.map((p) => ({ roleId, permissionId: permId.get(p)! })),
      skipDuplicates: true,
    });
  }
  log(`permissões: ${permissions.length}; perfis: ${Object.keys(SYSTEM_ROLES).length}`);

  let tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!tenant) {
    const slug = opts.tenantName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    tenant = await prisma.tenant.create({
      data: {
        name: opts.tenantName,
        slug: slug || "tenant",
        settings: { requireTrustedDevice: true, biometricMaxAgeSeconds: 300, lotExpiryAlertDays: 60 },
      },
    });
    log(`tenant criado: ${tenant.name}`);
  }
  const tenantId = tenant.id;

  for (const reason of DEFAULT_DELIVERY_REASONS) {
    await prisma.deliveryReason.upsert({
      where: { tenantId_code: { tenantId, code: reason.code } },
      update: {},
      create: { tenantId, ...reason },
    });
  }

  const terms = await prisma.deliveryTerms.findFirst({ where: { tenantId } });
  if (!terms) {
    await prisma.deliveryTerms.create({
      data: { tenantId, version: 1, text: DEFAULT_TERMS_TEXT, textHash: sha256(DEFAULT_TERMS_TEXT), active: true },
    });
  }

  const lgpdCount = await prisma.dataProcessingRecord.count({ where: { tenantId } });
  if (lgpdCount === 0) {
    await prisma.dataProcessingRecord.createMany({
      data: [
        {
          tenantId,
          purpose: "Comprovação do fornecimento de EPI (NR-6) por validação biométrica facial 1:1",
          dataCategory: "SENSITIVE_BIOMETRIC",
          legalBasis: "Art. 11, II, 'a' LGPD — cumprimento de obrigação legal/regulatória (NR-6)",
          source: "Captura facial no ato do cadastro/entrega",
          controller: opts.tenantName,
          retention: "Template: enquanto houver vínculo + revogação no desligamento. Resultado da verificação: prazo prescricional trabalhista/SST",
        },
        {
          tenantId,
          purpose: "Gestão de SST: cadastro do colaborador, entregas, treinamentos",
          dataCategory: "PERSONAL",
          legalBasis: "Art. 7º, II LGPD — cumprimento de obrigação legal",
          source: "RH / cadastro interno",
          controller: opts.tenantName,
          retention: "Durante o vínculo + 20 anos (registros de SST)",
        },
        {
          tenantId,
          purpose: "Saúde ocupacional (PCMSO, ASO, exames)",
          dataCategory: "SENSITIVE_HEALTH",
          legalBasis: "Art. 11, II, 'a' e 'f' LGPD — obrigação legal / tutela da saúde",
          source: "Clínica / médico do trabalho",
          controller: opts.tenantName,
          retention: "20 anos após desligamento (NR-7)",
        },
      ],
    });
  }

  const adminExists = await prisma.user.findUnique({ where: { email: opts.adminEmail.toLowerCase() } });
  if (!adminExists) {
    if (!opts.adminPassword || opts.adminPassword.length < 10) {
      log("SEED_ADMIN_PASSWORD ausente ou < 10 caracteres: admin não criado");
      return;
    }
    const superRole = await prisma.role.findFirstOrThrow({ where: { tenantId: null, key: "super_admin" } });
    await prisma.user.create({
      data: {
        tenantId,
        email: opts.adminEmail.toLowerCase(),
        name: "Administrador",
        passwordHash: await bcrypt.hash(opts.adminPassword, 12),
        roles: { create: [{ roleId: superRole.id }] },
      },
    });
    log(`admin criado: ${opts.adminEmail}`);
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
