import { z } from "zod";
import { isValidCnpj, isValidCpf, onlyDigits } from "./common.js";

const uuid = z.string().uuid();
const optionalUuid = uuid.optional().nullable();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");
const optionalText = z.string().trim().max(2000).optional().nullable();

export const cpfSchema = z
  .string()
  .transform(onlyDigits)
  .refine(isValidCpf, "CPF inválido");

export const cnpjSchema = z
  .string()
  .transform(onlyDigits)
  .refine(isValidCnpj, "CNPJ inválido");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  q: z.string().trim().optional(),
});
export type Pagination = z.infer<typeof paginationSchema>;

/* ---------- identity ---------- */

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  mfaCode: z.string().trim().optional(),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(20) });

export const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, "Mínimo 10 caracteres"),
  roles: z
    .array(z.object({ roleKey: z.string(), companyId: optionalUuid, establishmentId: optionalUuid }))
    .min(1),
  employeeId: optionalUuid,
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  status: z.enum(["ACTIVE", "BLOCKED"]).optional(),
  password: z.string().min(10).optional(),
  roles: z
    .array(z.object({ roleKey: z.string(), companyId: optionalUuid, establishmentId: optionalUuid }))
    .optional(),
});

export const deviceRegisterSchema = z.object({
  deviceKey: z.string().min(16).max(200),
  name: z.string().trim().min(1).max(120),
  model: z.string().trim().max(200).optional(),
  platform: z.string().trim().max(120).optional(),
});

export const deviceUpdateSchema = z.object({
  status: z.enum(["PENDING", "TRUSTED", "BLOCKED"]).optional(),
  name: z.string().trim().max(120).optional(),
  companyId: optionalUuid,
  establishmentId: optionalUuid,
});

/* ---------- organization ---------- */

export const companySchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().max(200).optional().nullable(),
  cnpj: cnpjSchema,
});

export const establishmentSchema = z.object({
  companyId: uuid,
  name: z.string().trim().min(2).max(200),
  code: z.string().trim().max(40).optional().nullable(),
  cnpj: z.string().transform(onlyDigits).optional().nullable(),
  address: optionalText,
});

export const unitSchema = z.object({
  establishmentId: uuid,
  name: z.string().trim().min(1).max(200),
});

export const departmentSchema = z.object({
  establishmentId: uuid,
  unitId: optionalUuid,
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().max(40).optional().nullable(),
});

export const jobSchema = z.object({
  companyId: uuid,
  name: z.string().trim().min(1).max(200),
  cbo: z.string().trim().max(10).optional().nullable(),
  description: optionalText,
});

/* ---------- people ---------- */

export const employeeStatus = z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED"]);

export const employeeCreateSchema = z.object({
  companyId: uuid,
  establishmentId: uuid,
  unitId: optionalUuid,
  departmentId: optionalUuid,
  jobId: optionalUuid,
  name: z.string().trim().min(2).max(200),
  cpf: cpfSchema,
  registration: z.string().trim().max(40).optional().nullable(),
  birthDate: dateStr.optional().nullable(),
  admissionDate: dateStr.optional().nullable(),
  cbo: z.string().trim().max(10).optional().nullable(),
  managerEmployeeId: optionalUuid,
  email: z.string().trim().email().optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(40).optional().nullable(),
});

export const employeeUpdateSchema = employeeCreateSchema
  .omit({ cpf: true, companyId: true })
  .partial()
  .extend({
    status: employeeStatus.optional(),
    terminationDate: dateStr.optional().nullable(),
    changeReason: z.string().trim().max(500).optional(),
    effectiveDate: dateStr.optional(),
  });

/* ---------- EPI ---------- */

export const epiGuidanceSchema = z
  .object({
    usage: optionalText,
    adjustment: optionalText,
    sanitization: optionalText,
    storage: optionalText,
    limitations: optionalText,
    coveredRisks: optionalText,
    videoUrl: z.string().url().optional().nullable().or(z.literal("")),
  })
  .partial();

export const epiProductSchema = z.object({
  internalCode: z.string().trim().min(1).max(60),
  description: z.string().trim().min(2).max(300),
  category: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(120).optional().nullable(),
  model: z.string().trim().max(120).optional().nullable(),
  manufacturer: z.string().trim().max(200).optional().nullable(),
  protectionType: z.string().trim().max(200).optional().nullable(),
  replacementDays: z.coerce.number().int().min(0).max(3650).optional().nullable(),
  unit: z.string().trim().max(20).default("UN"),
  color: z.string().trim().max(60).optional().nullable(),
  notes: optionalText,
  reusable: z.boolean().default(false),
  requiresReturn: z.boolean().default(false),
  unitCost: z.coerce.number().min(0).optional().nullable(),
  caNumber: z.string().trim().max(20).optional().nullable(),
  guidance: epiGuidanceSchema.optional(),
  variants: z
    .array(z.object({ size: z.string().trim().max(20).optional().nullable(), color: z.string().trim().max(60).optional().nullable(), ean: z.string().trim().max(20).optional().nullable() }))
    .optional(),
});

export const epiProductUpdateSchema = epiProductSchema.omit({ variants: true }).partial().extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const epiVariantSchema = z.object({
  size: z.string().trim().max(20).optional().nullable(),
  color: z.string().trim().max(60).optional().nullable(),
  ean: z.string().trim().max(20).optional().nullable(),
});

export const jobRequirementSchema = z.object({
  productId: uuid,
  quantity: z.coerce.number().int().min(1).default(1),
  replacementDays: z.coerce.number().int().min(0).optional().nullable(),
  notes: optionalText,
});

/* ---------- inventory ---------- */

export const warehouseSchema = z.object({
  establishmentId: uuid,
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(40),
  kind: z.enum(["CENTRAL", "UNIT", "SECTOR"]).default("CENTRAL"),
});

export const locationSchema = z.object({
  code: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200).optional().nullable(),
});

export const stockEntrySchema = z.object({
  warehouseId: uuid,
  locationId: optionalUuid,
  variantId: uuid,
  lotNumber: z.string().trim().min(1).max(60),
  caNumber: z.string().trim().min(1).max(20),
  expiryDate: dateStr.optional().nullable(),
  manufactureDate: dateStr.optional().nullable(),
  purchaseDate: dateStr,
  quantity: z.coerce.number().int().min(1),
  unitCost: z.coerce.number().min(0).optional().nullable(),
  supplier: z.string().trim().max(200).optional().nullable(),
  invoiceNumber: z.string().trim().max(60).optional().nullable(),
  caValidityAtPurchase: dateStr.optional().nullable(),
  notes: optionalText,
});

export const stockTransferSchema = z.object({
  fromWarehouseId: uuid,
  toWarehouseId: uuid,
  toLocationId: optionalUuid,
  notes: optionalText,
  items: z.array(z.object({ lotId: uuid, locationId: optionalUuid, quantity: z.coerce.number().int().min(1) })).min(1),
});

export const stockAdjustmentSchema = z.object({
  warehouseId: uuid,
  locationId: optionalUuid,
  lotId: uuid,
  type: z.enum(["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "LOSS", "DISPOSAL"]),
  quantity: z.coerce.number().int().min(1),
  reason: z.string().trim().min(3).max(500),
});

export const stockLevelSchema = z.object({
  warehouseId: uuid,
  variantId: uuid,
  minQty: z.coerce.number().int().min(0),
  maxQty: z.coerce.number().int().min(0).optional().nullable(),
  leadTimeDays: z.coerce.number().int().min(0).optional().nullable(),
});

export const inventoryCountCreateSchema = z.object({
  warehouseId: uuid,
  doubleCount: z.boolean().default(false),
  notes: optionalText,
});

export const inventoryCountItemsSchema = z.object({
  round: z.union([z.literal(1), z.literal(2)]),
  items: z.array(z.object({ itemId: uuid, quantity: z.coerce.number().int().min(0) })).min(1),
});

/* ---------- delivery ---------- */

export const deliveryItemInput = z.object({
  variantId: uuid,
  lotId: uuid.optional(),
  quantity: z.coerce.number().int().min(1).max(1000),
  reasonCode: z.string().trim().min(1),
  justification: z.string().trim().max(1000).optional().nullable(),
});

export const deliveryPrepareSchema = z.object({
  employeeId: uuid,
  warehouseId: uuid,
  items: z.array(deliveryItemInput).min(1).max(50),
});

export const deliveryCreateSchema = deliveryPrepareSchema.extend({
  termsVersion: z.coerce.number().int().min(1),
  confirmed: z.literal(true, { errorMap: () => ({ message: "Confirmação explícita do colaborador é obrigatória" }) }),
  biometricVerificationId: z.string().min(8),
});

export const cancelSchema = z.object({ reason: z.string().trim().min(5).max(1000) });

export const returnCreateSchema = z.object({
  employeeId: uuid,
  deliveryItemId: optionalUuid,
  variantId: uuid,
  lotId: optionalUuid,
  warehouseId: uuid,
  quantity: z.coerce.number().int().min(1),
  condition: z.enum(["GOOD", "WORN", "DAMAGED", "CONTAMINATED"]),
  reason: z.string().trim().min(2).max(500),
  destination: z.enum(["REUSABLE", "SANITIZATION", "MAINTENANCE", "DISCARDED"]),
  notes: optionalText,
});

export const returnStepSchema = z.object({
  step: z.enum(["SANITIZATION", "MAINTENANCE", "INSPECTION", "RELEASED", "DISCARDED"]),
  notes: optionalText,
});

export const deliveryReasonSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(2).max(120),
  requiresJustification: z.boolean().default(false),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(100),
});

export const termsSchema = z.object({ text: z.string().trim().min(20).max(5000) });

/* ---------- biometric ---------- */

export const biometricChallengeSchema = z.object({
  employeeId: uuid,
  purpose: z.enum(["ENROLL", "DELIVERY"]),
});

export const biometricFramesSchema = z.object({
  employeeId: uuid,
  challengeId: z.string().min(8),
  frames: z.array(z.string().min(100)).min(3).max(8),
});

export const biometricEnrollSchema = biometricFramesSchema.extend({
  legalBasis: z.string().trim().min(3).max(200).default("Cumprimento de obrigação legal (NR-6, item 6.6.1 'h') — art. 11, II, 'a', LGPD"),
});

/* ---------- documents ---------- */

export const documentEntityTypes = [
  "EMPLOYEE",
  "EPI_PRODUCT",
  "CA",
  "TRAINING",
  "PGR",
  "ASO",
  "ACCIDENT",
  "COMPANY",
  "DELIVERY",
] as const;

export const documentMetaSchema = z.object({
  entityType: z.enum(documentEntityTypes),
  entityId: z.string().min(1).max(64),
  category: z.string().trim().min(1).max(80).default("GERAL"),
  title: z.string().trim().min(1).max(200),
  isEvidence: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .default(false),
});

export const reportQuerySchema = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  companyId: uuid.optional(),
  establishmentId: uuid.optional(),
  departmentId: uuid.optional(),
  employeeId: uuid.optional(),
  groupBy: z.enum(["employee", "department", "job", "product", "manager"]).optional(),
  format: z.enum(["json", "csv", "xlsx", "pdf"]).default("json"),
});
