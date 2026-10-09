-- Login por biometria (passkey / WebAuthn)
ALTER TABLE "users" ADD COLUMN "webauthnUserHandle" TEXT;
CREATE UNIQUE INDEX "users_webauthnUserHandle_key" ON "users"("webauthnUserHandle");

CREATE TABLE "webauthn_credentials" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "signCount" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deviceName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3),

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webauthn_credentials_credentialId_key" ON "webauthn_credentials"("credentialId");
CREATE INDEX "webauthn_credentials_userId_idx" ON "webauthn_credentials"("userId");

ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
