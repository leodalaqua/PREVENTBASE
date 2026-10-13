import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_DELIVERY_REASONS, DEFAULT_TERMS_TEXT } from "@preventbase/contracts";

export interface SeedOptions {
  tenantName: string;
  log?: (msg: string) => void;
}

/** Idempotente: pode rodar a cada deploy. Só cria o tenant se não existir. Usuários vêm do login único Veritech. */
export async function runSeed(prisma: PrismaClient, opts: SeedOptions): Promise<void> {
  const log = opts.log ?? (() => undefined);

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

}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
