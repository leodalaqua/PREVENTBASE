# Identidade, permissões e dispositivos

## Responsabilidade

Login, sessão, MFA, perfis/permissões com escopo (§53-§55) e dispositivos confiáveis (§56).

## Estado atual

- `POST /auth/login` → access JWT (`JWT_ACCESS_TTL_SECONDS`, padrão 900 s) + refresh opaco rotativo (`REFRESH_TTL_DAYS`, padrão 14). Reuso de refresh revoga a família inteira.
- MFA TOTP opcional (`/auth/mfa/setup|enable|disable`); sessões listáveis/revogáveis (`/auth/sessions`).
- Login por biometria (passkey/WebAuthn) — padrão [2026-10-09-login-passkey.md](file:///C:/ROBBY/docs/decisions/2026-10-09-login-passkey.md): `/auth/passkey/login/options|verify` (públicas, 20 falhas/IP/15 min) emitem access + refresh como o login e **dispensam TOTP** (verificação do usuário no aparelho = 2º fator); auditoria `auth.login` com `method: passkey`. Cadastro/lista/remoção autenticados (`/auth/passkey`, `register/*`, `DELETE :id`). Tabela `webauthn_credentials` + `users.webauthnUserHandle`; origem `https://servidor.taild57d57.ts.net:13100`. Bloqueio do usuário ou troca de senha pelo admin apaga as passkeys. Web: botão no login, convite pós-senha, "Login biometria" no menu e card em `/conta`. Não confundir com a biometria de **entrega** do colaborador ([biometria.md](biometria.md)).
- Guard global: rota sem `@Public()` exige JWT; `@RequirePermissions(...)` confere o catálogo de `packages/permissions`; `@RequireTrustedDevice()` (entrega) exige header `X-Device-Key` de um dispositivo `TRUSTED`.
- Dispositivo: `POST /devices/register` cria `PENDING`; admin aprova em `PATCH /devices/:id` (`devices.manage`).
- Web: access só em memória; refresh em `localStorage` (`pb.refresh`); chave do aparelho em `pb.deviceKey`.
- Seed (`packages/database/src/seed.ts`): permissões, 10 perfis, motivos de entrega, termo v1, admin (`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` do `.env`, só na primeira execução).

## Fora do padrão do ecossistema

Padrão Robby = encerrar após 30 min sem interação ([authentication.md](file:///C:/ROBBY/docs/robby/authentication.md)). Hoje a sessão vive enquanto o refresh for válido (14 dias). Alinhar: keeper de inatividade no `(app)/layout.tsx` + TTL do refresh por inatividade.

## Arquivos

`apps/api/src/modules/identity/` · `apps/api/src/core/auth.guard.ts` · `apps/web/src/lib/api.ts`, `auth.tsx` · web `login/`, `(app)/conta/`, `(app)/dispositivo/`.
