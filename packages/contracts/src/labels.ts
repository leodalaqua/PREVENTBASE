export const MOVEMENT_LABELS: Record<string, string> = {
  ENTRY: "Entrada",
  DELIVERY: "Entrega",
  DELIVERY_CANCEL: "Estorno de entrega",
  RETURN: "Devolução",
  TRANSFER_OUT: "Transferência (saída)",
  TRANSFER_IN: "Transferência (entrada)",
  ADJUSTMENT_IN: "Ajuste (+)",
  ADJUSTMENT_OUT: "Ajuste (-)",
  LOSS: "Perda",
  DISPOSAL: "Descarte",
  INVENTORY_IN: "Inventário (+)",
  INVENTORY_OUT: "Inventário (-)",
};

export const DEFAULT_DELIVERY_REASONS: Array<{ code: string; name: string; requiresJustification: boolean; sortOrder: number }> = [
  { code: "INITIAL", name: "Entrega inicial", requiresJustification: false, sortOrder: 10 },
  { code: "WEAR", name: "Substituição por desgaste", requiresJustification: false, sortOrder: 20 },
  { code: "DAMAGE", name: "Dano", requiresJustification: true, sortOrder: 30 },
  { code: "LOSS", name: "Extravio", requiresJustification: true, sortOrder: 40 },
  { code: "EXPIRY", name: "Vencimento", requiresJustification: false, sortOrder: 50 },
  { code: "JOB_CHANGE", name: "Mudança de função", requiresJustification: false, sortOrder: 60 },
  { code: "RISK_CHANGE", name: "Mudança de risco", requiresJustification: true, sortOrder: 70 },
  { code: "PREVENTIVE", name: "Troca preventiva", requiresJustification: false, sortOrder: 80 },
  { code: "CONTAMINATION", name: "Contaminação", requiresJustification: true, sortOrder: 85 },
  { code: "ADJUSTMENT", name: "Ajuste", requiresJustification: true, sortOrder: 90 },
  { code: "OTHER", name: "Outros", requiresJustification: true, sortOrder: 100 },
];

/** Reasons that justify a replacement before the standard period (§23). */
export const EARLY_REPLACEMENT_REASONS = new Set(["DAMAGE", "LOSS", "CONTAMINATION", "JOB_CHANGE", "RISK_CHANGE", "OTHER"]);

export const DEFAULT_TERMS_TEXT =
  "Confirmo o recebimento dos equipamentos de proteção individual relacionados nesta entrega e declaro ter recebido as orientações aplicáveis quanto ao uso, guarda e conservação.";

export const EPI_CATEGORIES = [
  "Proteção da cabeça",
  "Proteção dos olhos e face",
  "Proteção auditiva",
  "Proteção respiratória",
  "Proteção do tronco",
  "Proteção dos membros superiores",
  "Proteção dos membros inferiores",
  "Proteção do corpo inteiro",
  "Proteção contra quedas",
];
