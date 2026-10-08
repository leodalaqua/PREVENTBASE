const TZ = "America/Sao_Paulo";

export function fmtDate(v?: string | Date | null): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  // datas puras (@db.Date) chegam como meia-noite UTC
  const pure = typeof v === "string" && /T00:00:00(\.000)?Z$/.test(v);
  return d.toLocaleDateString("pt-BR", { timeZone: pure ? "UTC" : TZ });
}

export function fmtDateTime(v?: string | Date | null): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
}

export function fmtMoney(v?: number | string | null): string {
  if (v === null || v === undefined || v === "") return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function maskCpf(cpf?: string | null): string {
  if (!cpf) return "—";
  const d = cpf.replace(/\D/g, "").padStart(11, "0");
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function maskCnpj(v?: string | null): string {
  if (!v) return "—";
  const d = v.replace(/\D/g, "");
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : v;
}

export function today(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
}

export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toLocaleDateString("sv-SE", { timeZone: TZ });
}

export const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativo",
  ON_LEAVE: "Afastado",
  TERMINATED: "Desligado",
  INACTIVE: "Inativo",
  CANCELLED: "Cancelada",
  PENDING: "Pendente",
  TRUSTED: "Confiável",
  BLOCKED: "Bloqueado",
  MISSING: "Não entregue",
  OVERDUE: "Troca vencida",
  OK: "Em dia",
  OPEN: "Aberto",
  COUNTING: "Em contagem",
  DIVERGENT: "Divergente",
  APPROVED: "Aprovado",
  CLOSED: "Fechado",
};

export const MOVEMENT_LABEL: Record<string, string> = {
  ENTRY: "Entrada",
  DELIVERY: "Entrega",
  DELIVERY_CANCEL: "Estorno de entrega",
  RETURN: "Devolução",
  TRANSFER_OUT: "Transferência (saída)",
  TRANSFER_IN: "Transferência (entrada)",
  ADJUSTMENT_IN: "Ajuste (+)",
  ADJUSTMENT_OUT: "Ajuste (−)",
  LOSS: "Perda",
  DISPOSAL: "Descarte",
  INVENTORY_IN: "Inventário (+)",
  INVENTORY_OUT: "Inventário (−)",
};
