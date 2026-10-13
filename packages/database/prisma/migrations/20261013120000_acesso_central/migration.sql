-- Acesso só pela central Veritech: CPF no espelho do usuário e isAdmin/permissoes gravados na sessão.
-- Perfis/permissões locais (roles, permissions, role_permissions, user_roles) e passkeys locais ficam sem uso.
ALTER TABLE "users" ADD COLUMN "cpf" TEXT;
CREATE UNIQUE INDEX "users_cpf_key" ON "users"("cpf");

ALTER TABLE "sessions" ADD COLUMN "ssoIsAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sessions" ADD COLUMN "ssoPermissoes" JSONB;
ALTER TABLE "sessions" ADD COLUMN "ssoMfa" BOOLEAN NOT NULL DEFAULT false;

-- Sessões abertas não têm as permissões da central: novo login (o navegador volta pela central sozinho).
UPDATE "sessions" SET "revokedAt" = now(), "revokedReason" = 'acesso_central' WHERE "revokedAt" IS NULL;
