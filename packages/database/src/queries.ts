import { Prisma, type PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export interface RequirementStatusRow {
  employeeId: string;
  employeeName: string;
  companyId: string;
  establishmentId: string;
  departmentId: string | null;
  jobId: string;
  productId: string;
  productDescription: string;
  requiredQty: number;
  replacementDays: number | null;
  lastDeliveredAt: Date | null;
  lastQty: number | null;
  nextReplacementDue: Date | null;
  status: "MISSING" | "OVERDUE" | "OK";
}

/** EPIs obrigatórios (matriz Função × EPI) × última entrega ativa de cada colaborador. */
export function requirementStatus(
  db: Db,
  tenantId: string,
  opts: { employeeId?: string; companyIds?: string[] | null; onlyPending?: boolean } = {},
): Promise<RequirementStatusRow[]> {
  const byEmployee = opts.employeeId ? Prisma.sql`AND e.id = ${opts.employeeId}::uuid` : Prisma.empty;
  const byCompany = opts.companyIds ? Prisma.sql`AND e."companyId" = ANY(${opts.companyIds}::uuid[])` : Prisma.empty;
  const pending = opts.onlyPending
    ? Prisma.sql`AND (li.id IS NULL OR (li."nextReplacementDue" IS NOT NULL AND li."nextReplacementDue" < CURRENT_DATE))`
    : Prisma.empty;
  return db.$queryRaw<RequirementStatusRow[]>`
    SELECT e.id AS "employeeId", e.name AS "employeeName", e."companyId", e."establishmentId", e."departmentId", e."jobId",
           p.id AS "productId", p.description AS "productDescription", r.quantity AS "requiredQty",
           COALESCE(r."replacementDays", p."replacementDays") AS "replacementDays",
           li."deliveredAt" AS "lastDeliveredAt", li.quantity AS "lastQty", li."nextReplacementDue",
           CASE WHEN li.id IS NULL THEN 'MISSING'
                WHEN li."nextReplacementDue" IS NOT NULL AND li."nextReplacementDue" < CURRENT_DATE THEN 'OVERDUE'
                ELSE 'OK' END AS status
    FROM employees e
    JOIN epi_job_requirements r ON r."jobId" = e."jobId" AND r.active
    JOIN epi_products p ON p.id = r."productId"
    LEFT JOIN LATERAL (
      SELECT i.id, i.quantity, i."nextReplacementDue", d."deliveredAt"
      FROM epi_delivery_items i JOIN epi_deliveries d ON d.id = i."deliveryId"
      WHERE i."employeeId" = e.id AND i."productId" = p.id AND d.status = 'ACTIVE'
      ORDER BY d."deliveredAt" DESC LIMIT 1
    ) li ON true
    WHERE e."tenantId" = ${tenantId}::uuid AND e.status = 'ACTIVE' ${byEmployee} ${byCompany} ${pending}
    ORDER BY e.name, p.description`;
}

export interface LowStockRow {
  warehouseId: string;
  warehouseName: string;
  variantId: string;
  sku: string;
  productDescription: string;
  minQty: number;
  maxQty: number | null;
  quantity: number;
}

export function lowStock(db: Db, tenantId: string): Promise<LowStockRow[]> {
  return db.$queryRaw<LowStockRow[]>`
    SELECT l."warehouseId", w.name AS "warehouseName", l."variantId", v.sku, p.description AS "productDescription",
           l."minQty", l."maxQty", COALESCE(s.qty, 0)::int AS quantity
    FROM stock_levels l
    JOIN warehouses w ON w.id = l."warehouseId"
    JOIN epi_variants v ON v.id = l."variantId"
    JOIN epi_products p ON p.id = v."productId"
    LEFT JOIN (
      SELECT b."warehouseId", lo."variantId", SUM(b.quantity) AS qty
      FROM stock_balances b JOIN stock_lots lo ON lo.id = b."lotId"
      WHERE lo."expiryDate" IS NULL OR lo."expiryDate" >= CURRENT_DATE
      GROUP BY 1, 2
    ) s ON s."warehouseId" = l."warehouseId" AND s."variantId" = l."variantId"
    WHERE l."tenantId" = ${tenantId}::uuid AND COALESCE(s.qty, 0) <= l."minQty"
    ORDER BY p.description`;
}

export interface ExpiringLotRow {
  lotId: string;
  lotNumber: string;
  expiryDate: Date;
  caNumber: string;
  productDescription: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  expired: boolean;
}

export function expiringLots(db: Db, tenantId: string, days: number): Promise<ExpiringLotRow[]> {
  return db.$queryRaw<ExpiringLotRow[]>`
    SELECT lo.id AS "lotId", lo."lotNumber", lo."expiryDate", lo."caNumber", p.description AS "productDescription", v.sku,
           b."warehouseId", w.name AS "warehouseName", SUM(b.quantity)::int AS quantity,
           (lo."expiryDate" < CURRENT_DATE) AS expired
    FROM stock_lots lo
    JOIN stock_balances b ON b."lotId" = lo.id AND b.quantity > 0
    JOIN warehouses w ON w.id = b."warehouseId"
    JOIN epi_variants v ON v.id = lo."variantId"
    JOIN epi_products p ON p.id = v."productId"
    WHERE lo."tenantId" = ${tenantId}::uuid AND lo."expiryDate" IS NOT NULL
      AND lo."expiryDate" <= CURRENT_DATE + ${days}::int
    GROUP BY lo.id, p.description, v.sku, b."warehouseId", w.name
    ORDER BY lo."expiryDate"`;
}

export interface StockDriftRow {
  warehouseId: string;
  locationId: string;
  lotId: string;
  balance: number;
  movements: number;
}

/** Saldo projetado × soma dos movimentos (§14: saldo é consequência dos movimentos). */
export function stockDrift(db: Db, tenantId: string): Promise<StockDriftRow[]> {
  return db.$queryRaw<StockDriftRow[]>`
    SELECT COALESCE(b."warehouseId", m."warehouseId") AS "warehouseId", COALESCE(b."locationId", m."locationId") AS "locationId",
           COALESCE(b."lotId", m."lotId") AS "lotId", COALESCE(b.quantity, 0)::int AS balance, COALESCE(m.total, 0)::int AS movements
    FROM (SELECT * FROM stock_balances WHERE "tenantId" = ${tenantId}::uuid) b
    FULL OUTER JOIN (
      SELECT "warehouseId", "locationId", "lotId", SUM(quantity) AS total FROM stock_movements
      WHERE "tenantId" = ${tenantId}::uuid GROUP BY 1, 2, 3
    ) m ON m."warehouseId" = b."warehouseId" AND m."locationId" = b."locationId" AND m."lotId" = b."lotId"
    WHERE COALESCE(b.quantity, 0) <> COALESCE(m.total, 0)`;
}
