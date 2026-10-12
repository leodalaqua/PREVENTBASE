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

## Login único Veritech

Contrato canônico: [sso-veritech.md](file:///C:/ROBBY/docs/robby/sso-veritech.md) (app `preventbase`).

- `GET /auth/sso-config` → `{url, app, local}` · `POST /auth/sso {ticket}` resgata na central (`VERITECH_SSO_INTERNAL_URL`, 5 s; 401 inválido, 503 indisponível) e emite o mesmo access + refresh, com `sessions.ssoSid`.
- Usuário por e-mail (sem CPF no `User`); só cria se houver um único tenant; senha aleatória. Novo → **sem nenhum acesso**: `status BLOCKED` e nenhum perfil, 403 `SSO_PENDING` "Acesso criado. Aguarde a liberação do administrador." (repete enquanto bloqueado e sem perfil; web mostra aviso no `login/`). Liberar = atribuir perfil/escopo (`PATCH /users/:id {roles}`) e reativar. Exceção: `isAdmin` central → `super_admin` ativo. Bloqueado com perfil → 403 `USER_BLOCKED`.
- `mfa: true` do redeem (senha + 2FA ou biometria na central) ou `metodo: passkey` dispensa o TOTP; sem segundo fator na central e MFA ativo → 401 `MFA_REQUIRED` + `details.mfaToken` (5 min, 3 tentativas) e reenvio `POST /auth/sso {mfaToken, mfaCode}`.
- Refresh de sessão SSO chama `/sso/check`: `active:false` revoga a família (401 `SSO_ENDED`); falha de rede mantém.
- Login por senha só com `VERITECH_SSO_LOCAL_LOGIN` ≠ `0`; 3 falhas por e-mail+IP ou 20 por IP em 15 min → 429.
- Web: botão principal no `login/` (redirecionamento automático 1x por aba, `pb.ssoAuto`), conta local atrás de "Usar conta local"; Sair → `/sair` da central.

## Fora do padrão do ecossistema

Padrão Robby = encerrar após 30 min sem interação ([authentication.md](file:///C:/ROBBY/docs/robby/authentication.md)). Hoje a sessão vive enquanto o refresh for válido (14 dias). Alinhar: keeper de inatividade no `(app)/layout.tsx` + TTL do refresh por inatividade.

## Arquivos

`apps/api/src/modules/identity/` (SSO: `sso.ts`, `auth.service.ts`, `sso.test.ts`) · `apps/api/src/core/auth.guard.ts` · `apps/web/src/lib/api.ts`, `auth.tsx`, `sso.ts` · web `login/`, `(app)/conta/`, `(app)/dispositivo/`.
