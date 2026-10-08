-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('PENDING', 'TRUSTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ActiveStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WarehouseKind" AS ENUM ('CENTRAL', 'UNIT', 'SECTOR');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTRY', 'DELIVERY', 'DELIVERY_CANCEL', 'RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'LOSS', 'DISPOSAL', 'INVENTORY_IN', 'INVENTORY_OUT');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('OPEN', 'COUNTING', 'DIVERGENT', 'APPROVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('GOOD', 'WORN', 'DAMAGED', 'CONTAMINATED');

-- CreateEnum
CREATE TYPE "ReturnDestination" AS ENUM ('REUSABLE', 'SANITIZATION', 'MAINTENANCE', 'DISCARDED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "cnpj" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "establishments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "cnpj" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "establishments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "unitId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cbo" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "unitId" UUID,
    "departmentId" UUID,
    "jobId" UUID,
    "managerEmployeeId" UUID,
    "name" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "registration" TEXT,
    "birthDate" DATE,
    "admissionDate" DATE,
    "terminationDate" DATE,
    "cbo" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "photoDocumentId" UUID,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_history" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "fromValue" JSONB,
    "toValue" JSONB,
    "reason" TEXT,
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "employeeId" UUID,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "companyId" UUID,
    "establishmentId" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceId" UUID,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "rotatedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedReason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID,
    "establishmentId" UUID,
    "deviceKeyHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "platform" TEXT,
    "responsibleUserId" UUID,
    "status" "DeviceStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "lastSeenAt" TIMESTAMPTZ(3),
    "lastIp" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epi_products" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "internalCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "manufacturer" TEXT,
    "protectionType" TEXT,
    "replacementDays" INTEGER,
    "unit" TEXT NOT NULL DEFAULT 'UN',
    "color" TEXT,
    "notes" TEXT,
    "reusable" BOOLEAN NOT NULL DEFAULT false,
    "requiresReturn" BOOLEAN NOT NULL DEFAULT false,
    "unitCost" DECIMAL(14,4),
    "guidance" JSONB NOT NULL DEFAULT '{}',
    "manualDocumentId" UUID,
    "imageDocumentId" UUID,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "epi_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epi_variants" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "size" TEXT,
    "color" TEXT,
    "sku" TEXT NOT NULL,
    "ean" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "epi_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epi_ca" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "caNumber" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "linkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinkedAt" TIMESTAMPTZ(3),
    "linkedById" UUID,

    CONSTRAINT "epi_ca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epi_job_requirements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "replacementDays" INTEGER,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "epi_job_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epi_kits" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "epi_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epi_kit_items" (
    "id" UUID NOT NULL,
    "kitId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "epi_kit_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_reasons" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requiresJustification" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_terms" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ca_manufacturer" (
    "cnpj" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ca_manufacturer_pkey" PRIMARY KEY ("cnpj")
);

-- CreateTable
CREATE TABLE "ca_master" (
    "caNumber" TEXT NOT NULL,
    "validUntil" DATE,
    "situation" TEXT,
    "processNumber" TEXT,
    "manufacturerCnpj" TEXT,
    "manufacturerName" TEXT,
    "nature" TEXT,
    "equipmentName" TEXT,
    "equipmentDescription" TEXT,
    "brand" TEXT,
    "reference" TEXT,
    "color" TEXT,
    "approvedFor" TEXT,
    "restrictions" TEXT,
    "observations" TEXT,
    "labCnpj" TEXT,
    "labName" TEXT,
    "reportNumber" TEXT,
    "standard" TEXT,
    "rowHash" TEXT NOT NULL,
    "syncId" UUID,
    "syncedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ca_master_pkey" PRIMARY KEY ("caNumber")
);

-- CreateTable
CREATE TABLE "ca_history" (
    "id" UUID NOT NULL,
    "caNumber" TEXT NOT NULL,
    "syncId" UUID,
    "changedFields" TEXT[],
    "previous" JSONB,
    "current" JSONB NOT NULL,
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ca_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ca_sync" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fileHash" TEXT,
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "triggeredBy" TEXT,

    CONSTRAINT "ca_sync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "WarehouseKind" NOT NULL DEFAULT 'CENTRAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_locations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lots" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "caNumber" TEXT NOT NULL,
    "manufactureDate" DATE,
    "expiryDate" DATE,
    "purchaseDate" DATE NOT NULL,
    "caValidityAtPurchase" DATE,
    "caValidAtPurchase" BOOLEAN,
    "unitCost" DECIMAL(14,4),
    "supplier" TEXT,
    "invoiceNumber" TEXT,
    "publicCode" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "unitCost" DECIMAL(14,4),
    "referenceType" TEXT,
    "referenceId" UUID,
    "reason" TEXT,
    "createdById" UUID,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "minQty" INTEGER NOT NULL DEFAULT 0,
    "maxQty" INTEGER,
    "leadTimeDays" INTEGER,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "fromWarehouseId" UUID NOT NULL,
    "toWarehouseId" UUID NOT NULL,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_counts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "status" "InventoryStatus" NOT NULL DEFAULT 'OPEN',
    "doubleCount" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "openedById" UUID,
    "approvedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "approvedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_items" (
    "id" UUID NOT NULL,
    "countId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "systemQty" INTEGER NOT NULL,
    "count1" INTEGER,
    "count1ById" UUID,
    "count2" INTEGER,
    "count2ById" UUID,
    "finalQty" INTEGER,

    CONSTRAINT "inventory_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epi_deliveries" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "departmentId" UUID,
    "jobId" UUID,
    "employeeId" UUID NOT NULL,
    "managerUserId" UUID NOT NULL,
    "deviceId" UUID,
    "warehouseId" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "deliveredAt" TIMESTAMPTZ(3) NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" UUID,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "epi_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epi_delivery_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "productDescription" TEXT NOT NULL,
    "caNumber" TEXT NOT NULL,
    "manufacturer" TEXT,
    "lotNumber" TEXT NOT NULL,
    "lotExpiryDate" DATE,
    "caValidAtPurchase" BOOLEAN,
    "quantity" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "justification" TEXT,
    "isEarlyReplacement" BOOLEAN NOT NULL DEFAULT false,
    "replacesItemId" UUID,
    "nextReplacementDue" DATE,
    "unitCost" DECIMAL(14,4),
    "stockMovementId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "epi_delivery_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_evidence" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "verificationMethod" TEXT NOT NULL,
    "biometricVerificationId" TEXT NOT NULL,
    "biometricScore" DOUBLE PRECISION NOT NULL,
    "livenessResult" BOOLEAN NOT NULL,
    "livenessChallenge" TEXT,
    "termsVersion" INTEGER NOT NULL,
    "termsTextHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "sessionId" UUID,
    "deviceId" UUID,
    "requestId" TEXT,
    "canonicalPayload" JSONB NOT NULL,
    "hashAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256',
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epi_returns" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "deliveryItemId" UUID,
    "variantId" UUID NOT NULL,
    "lotId" UUID,
    "warehouseId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" "ReturnCondition" NOT NULL,
    "destination" "ReturnDestination" NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "stage" TEXT NOT NULL,
    "stockMovementId" UUID,
    "receivedById" UUID NOT NULL,
    "returnedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" UUID,
    "cancellationReason" TEXT,

    CONSTRAINT "epi_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epi_return_steps" (
    "id" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "step" TEXT NOT NULL,
    "notes" TEXT,
    "performedById" UUID NOT NULL,
    "performedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "epi_return_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biometric_profiles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "externalProfileId" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "quality" DOUBLE PRECISION,
    "purpose" TEXT NOT NULL,
    "legalBasis" TEXT NOT NULL,
    "enrolledById" UUID NOT NULL,
    "deviceId" UUID,
    "enrolledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" UUID,
    "revocationReason" TEXT,

    CONSTRAINT "biometric_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biometric_verifications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "externalVerificationId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "liveness" BOOLEAN NOT NULL,
    "challengeAction" TEXT,
    "reason" TEXT,
    "deviceId" UUID,
    "requestedById" UUID NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "consumedByDeliveryId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biometric_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isEvidence" BOOLEAN NOT NULL DEFAULT false,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedById" UUID NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "deviceId" UUID,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousHash" TEXT NOT NULL,
    "currentHash" TEXT NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_processing_records" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "dataCategory" TEXT NOT NULL,
    "legalBasis" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "controller" TEXT NOT NULL,
    "retention" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "data_processing_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "agentCode" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_agents" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "risk_agents_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "job_risks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "riskId" UUID NOT NULL,
    "activity" TEXT,
    "evaluation" JSONB,
    "controls" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pgr" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pgr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pgr_versions" (
    "id" UUID NOT NULL,
    "pgrId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "content" JSONB NOT NULL,
    "documentId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pgr_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nr" TEXT,
    "workloadHours" DOUBLE PRECISION,
    "validityDays" INTEGER,
    "content" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_classes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "trainingId" UUID NOT NULL,
    "instructor" TEXT,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3),
    "location" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_participants" (
    "id" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMPTZ(3),
    "validUntil" DATE,
    "certificateId" UUID,

    CONSTRAINT "training_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_records" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "fitness" TEXT NOT NULL,
    "restrictions" TEXT,
    "validUntil" DATE,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "health_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_medical_exams" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3),
    "performedAt" TIMESTAMPTZ(3),
    "clinic" TEXT,
    "physician" TEXT,
    "crm" TEXT,
    "clinicalData" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_medical_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_aso" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "issuedAt" DATE NOT NULL,
    "validUntil" DATE,
    "fitness" TEXT NOT NULL,
    "physician" TEXT,
    "crm" TEXT,
    "documentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_aso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accidents" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "employeeId" UUID,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "location" TEXT,
    "activity" TEXT,
    "description" TEXT NOT NULL,
    "injury" TEXT,
    "bodyPart" TEXT,
    "witnesses" TEXT,
    "cause" TEXT,
    "correctiveAction" TEXT,
    "esocialEventId" UUID,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esocial_event_raw" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sha256" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "filename" TEXT,
    "xml" TEXT NOT NULL,
    "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esocial_event_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esocial_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "rawId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "receipt" TEXT,
    "layoutVersion" TEXT,
    "employerDoc" TEXT,
    "workerCpf" TEXT,
    "eventDate" DATE,
    "parsed" JSONB NOT NULL,
    "excludedBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esocial_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esocial_sync" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stats" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "esocial_sync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esocial_divergences" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID,
    "eventId" UUID,
    "field" TEXT NOT NULL,
    "localValue" TEXT,
    "esocialValue" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esocial_divergences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenantId_cnpj_key" ON "companies"("tenantId", "cnpj");

-- CreateIndex
CREATE INDEX "establishments_tenantId_companyId_idx" ON "establishments"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "units_tenantId_establishmentId_idx" ON "units"("tenantId", "establishmentId");

-- CreateIndex
CREATE INDEX "departments_tenantId_establishmentId_idx" ON "departments"("tenantId", "establishmentId");

-- CreateIndex
CREATE INDEX "jobs_tenantId_companyId_idx" ON "jobs"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "employees_tenantId_companyId_status_idx" ON "employees"("tenantId", "companyId", "status");

-- CreateIndex
CREATE INDEX "employees_tenantId_name_idx" ON "employees"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenantId_cpf_key" ON "employees"("tenantId", "cpf");

-- CreateIndex
CREATE INDEX "employee_history_tenantId_employeeId_effectiveAt_idx" ON "employee_history"("tenantId", "employeeId", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_key_key" ON "roles"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "user_roles_userId_idx" ON "user_roles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_familyId_idx" ON "sessions"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "devices_tenantId_deviceKeyHash_key" ON "devices"("tenantId", "deviceKeyHash");

-- CreateIndex
CREATE INDEX "epi_products_tenantId_description_idx" ON "epi_products"("tenantId", "description");

-- CreateIndex
CREATE UNIQUE INDEX "epi_products_tenantId_internalCode_key" ON "epi_products"("tenantId", "internalCode");

-- CreateIndex
CREATE INDEX "epi_variants_tenantId_ean_idx" ON "epi_variants"("tenantId", "ean");

-- CreateIndex
CREATE UNIQUE INDEX "epi_variants_tenantId_sku_key" ON "epi_variants"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "epi_ca_tenantId_caNumber_idx" ON "epi_ca"("tenantId", "caNumber");

-- CreateIndex
CREATE INDEX "epi_ca_productId_isCurrent_idx" ON "epi_ca"("productId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "epi_job_requirements_jobId_productId_key" ON "epi_job_requirements"("jobId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "epi_kits_tenantId_name_key" ON "epi_kits"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "epi_kit_items_kitId_productId_key" ON "epi_kit_items"("kitId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_reasons_tenantId_code_key" ON "delivery_reasons"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_terms_tenantId_version_key" ON "delivery_terms"("tenantId", "version");

-- CreateIndex
CREATE INDEX "ca_master_manufacturerCnpj_idx" ON "ca_master"("manufacturerCnpj");

-- CreateIndex
CREATE INDEX "ca_history_caNumber_changedAt_idx" ON "ca_history"("caNumber", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenantId_code_key" ON "warehouses"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_warehouseId_code_key" ON "stock_locations"("warehouseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lots_publicCode_key" ON "stock_lots"("publicCode");

-- CreateIndex
CREATE INDEX "stock_lots_tenantId_variantId_expiryDate_idx" ON "stock_lots"("tenantId", "variantId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lots_tenantId_variantId_lotNumber_caNumber_key" ON "stock_lots"("tenantId", "variantId", "lotNumber", "caNumber");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_createdAt_idx" ON "stock_movements"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_lotId_idx" ON "stock_movements"("lotId");

-- CreateIndex
CREATE INDEX "stock_movements_warehouseId_createdAt_idx" ON "stock_movements"("warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_referenceType_referenceId_idx" ON "stock_movements"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "stock_balances_tenantId_lotId_idx" ON "stock_balances"("tenantId", "lotId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_warehouseId_locationId_lotId_key" ON "stock_balances"("warehouseId", "locationId", "lotId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_warehouseId_variantId_key" ON "stock_levels"("warehouseId", "variantId");

-- CreateIndex
CREATE INDEX "stock_transfers_tenantId_createdAt_idx" ON "stock_transfers"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_counts_tenantId_status_idx" ON "inventory_counts"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_items_countId_lotId_locationId_key" ON "inventory_count_items"("countId", "lotId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "epi_deliveries_publicId_key" ON "epi_deliveries"("publicId");

-- CreateIndex
CREATE INDEX "epi_deliveries_tenantId_deliveredAt_idx" ON "epi_deliveries"("tenantId", "deliveredAt");

-- CreateIndex
CREATE INDEX "epi_deliveries_employeeId_deliveredAt_idx" ON "epi_deliveries"("employeeId", "deliveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "epi_deliveries_tenantId_idempotencyKey_key" ON "epi_deliveries"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "epi_delivery_items_tenantId_employeeId_productId_idx" ON "epi_delivery_items"("tenantId", "employeeId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_evidence_deliveryId_key" ON "delivery_evidence"("deliveryId");

-- CreateIndex
CREATE INDEX "epi_returns_tenantId_returnedAt_idx" ON "epi_returns"("tenantId", "returnedAt");

-- CreateIndex
CREATE INDEX "biometric_profiles_tenantId_employeeId_status_idx" ON "biometric_profiles"("tenantId", "employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "biometric_verifications_externalVerificationId_key" ON "biometric_verifications"("externalVerificationId");

-- CreateIndex
CREATE UNIQUE INDEX "biometric_verifications_consumedByDeliveryId_key" ON "biometric_verifications"("consumedByDeliveryId");

-- CreateIndex
CREATE INDEX "biometric_verifications_tenantId_employeeId_createdAt_idx" ON "biometric_verifications"("tenantId", "employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "documents_tenantId_entityType_entityId_idx" ON "documents"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_version_key" ON "document_versions"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_currentHash_key" ON "audit_logs"("currentHash");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_id_idx" ON "audit_logs"("tenantId", "id");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entityType_entityId_idx" ON "audit_logs"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_tenantId_scope_key_key" ON "idempotency_records"("tenantId", "scope", "key");

-- CreateIndex
CREATE INDEX "notifications_tenantId_resolvedAt_createdAt_idx" ON "notifications"("tenantId", "resolvedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenantId_dedupeKey_key" ON "notifications"("tenantId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "job_risks_jobId_riskId_key" ON "job_risks"("jobId", "riskId");

-- CreateIndex
CREATE UNIQUE INDEX "pgr_versions_pgrId_version_key" ON "pgr_versions"("pgrId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "training_participants_classId_employeeId_key" ON "training_participants"("classId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "health_records_tenantId_employeeId_key" ON "health_records"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "health_medical_exams_tenantId_employeeId_idx" ON "health_medical_exams"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "health_aso_tenantId_employeeId_idx" ON "health_aso"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "accidents_tenantId_occurredAt_idx" ON "accidents"("tenantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "esocial_event_raw_tenantId_sha256_key" ON "esocial_event_raw"("tenantId", "sha256");

-- CreateIndex
CREATE INDEX "esocial_events_tenantId_workerCpf_eventType_idx" ON "esocial_events"("tenantId", "workerCpf", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "esocial_events_tenantId_eventId_key" ON "esocial_events"("tenantId", "eventId");

-- CreateIndex
CREATE INDEX "esocial_divergences_tenantId_status_idx" ON "esocial_divergences"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "establishments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "establishments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "establishments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_managerEmployeeId_fkey" FOREIGN KEY ("managerEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_history" ADD CONSTRAINT "employee_history_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epi_variants" ADD CONSTRAINT "epi_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "epi_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epi_ca" ADD CONSTRAINT "epi_ca_productId_fkey" FOREIGN KEY ("productId") REFERENCES "epi_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epi_job_requirements" ADD CONSTRAINT "epi_job_requirements_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epi_job_requirements" ADD CONSTRAINT "epi_job_requirements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "epi_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epi_kit_items" ADD CONSTRAINT "epi_kit_items_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "epi_kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epi_kit_items" ADD CONSTRAINT "epi_kit_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "epi_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ca_history" ADD CONSTRAINT "ca_history_caNumber_fkey" FOREIGN KEY ("caNumber") REFERENCES "ca_master"("caNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "establishments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "epi_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "epi_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_countId_fkey" FOREIGN KEY ("countId") REFERENCES "inventory_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epi_deliveries" ADD CONSTRAINT "epi_deliveries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epi_delivery_items" ADD CONSTRAINT "epi_delivery_items_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "epi_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_evidence" ADD CONSTRAINT "delivery_evidence_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "epi_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epi_returns" ADD CONSTRAINT "epi_returns_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epi_return_steps" ADD CONSTRAINT "epi_return_steps_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "epi_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_profiles" ADD CONSTRAINT "biometric_profiles_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_risks" ADD CONSTRAINT "job_risks_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_risks" ADD CONSTRAINT "job_risks_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "risks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pgr_versions" ADD CONSTRAINT "pgr_versions_pgrId_fkey" FOREIGN KEY ("pgrId") REFERENCES "pgr"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_classes" ADD CONSTRAINT "training_classes_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "trainings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_participants" ADD CONSTRAINT "training_participants_classId_fkey" FOREIGN KEY ("classId") REFERENCES "training_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
