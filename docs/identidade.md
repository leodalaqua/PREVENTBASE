# Identidade, acesso e dispositivos

## Responsabilidade

Login, sessão, MFA do app e dispositivos confiáveis (§56). **Quem entra e o que pode fazer é decidido só pela central Veritech** (login único) — contrato canônico: [sso-veritech.md](file:///C:/ROBBY/docs/robby/sso-veritech.md) (app `preventbase`). Não há perfis, permissões, liberação de usuários nem tela de usuários no PreventBase.

## Estado atual

- Sessão: access JWT (`JWT_ACCESS_TTL_SECONDS`, padrão 900 s) + refresh opaco rotativo (`REFRESH_TTL_DAYS`, padrão 14). Reuso de refresh revoga a família inteira.
- `GET /auth/sso-config` → `{url, app, local}` · `POST /auth/sso {ticket}` resgata na central (`VERITECH_SSO_INTERNAL_URL`, 5 s; 401 inválido, 503 indisponível).
- "Usar conta local" (`VERITECH_SSO_LOCAL_LOGIN` ≠ `0`): `POST /auth/login {login, senha}` repassa à central `/sso/password` (app fixo no servidor + IP do navegador). 2FA da central → 401 `SSO_MFA_REQUIRED` + `details.ssoMfaToken`; reenvio `{ssoMfaToken, codigo}` → `/sso/password/2fa`. 401/403/429 da central são repassados (mensagem da central). Senha local não vale mais (`users.passwordHash` aleatório, sem uso). 3 falhas por login+IP ou 20 por IP em 15 min → 429 também no app.
- Usuário = **espelho** (FK de auditoria/autoria): busca por `users.cpf`, depois e-mail (case-insensitive); não achou → cria **ativo** (só com um tenant). Todo login sincroniza nome/CPF/e-mail (e-mail só se livre) e reativa. Conta central sem e-mail → `<cpf>@sso.veritech.invalid`.
- Sessão (`sessions`) guarda `ssoSid`, `ssoIsAdmin`, `ssoPermissoes` (árvore da central), `ssoMfa`. Renovação chama `/sso/check`: `active:false` revoga a família (401 `SSO_ENDED`); `active:true` grava `isAdmin`/`permissoes` novos; falha de rede mantém os anteriores. Sessão sem `ssoSid` não autentica nem renova.
- MFA TOTP do app (`/auth/mfa/setup|enable|disable`, em `/conta`): `mfa: true` da central (senha + 2FA ou biometria) ou `metodo: passkey` dispensa; sem segundo fator na central e TOTP ativo → 401 `MFA_REQUIRED` + `details.mfaToken` (5 min, 3 tentativas) e reenvio `POST /auth/sso {mfaToken, mfaCode}` (também aceito em `/auth/login`).
- `GET /auth/me` → usuário, tenant, `isAdmin`, `permissoes`, dispositivo. Sessões listáveis/revogáveis (`/auth/sessions`).
- Biometria **de login** só na central (passkey local removida; tabela `webauthn_credentials` mantida sem uso). Não confundir com a biometria de **entrega** do colaborador ([biometria.md](biometria.md)), que segue igual.

## Autorização

- Catálogo do sistema: `C:\ROBBY\config\acessos-catalogo\preventbase.json`, espelhado em `packages/permissions` (`CATALOGO`). Mudou um, muda o outro (e reiniciar o hub).
- Guard global (`core/auth.guard.ts`): rota sem `@Public()` exige JWT + sessão central; `@Acesso("modulo.submodulo.acao", …)` passa com `isAdmin` ou qualquer uma das chaves (`pode()` de `@preventbase/permissions`). `"*"` = alguma tela com `visualizar` (listas de apoio: empresas, estabelecimentos, setores, funções, almoxarifados, motivos, termo vigente). Rota autenticada sem `@Acesso` = só a própria conta (me, sessões, MFA, registro do aparelho).
- Listas usadas por várias telas aceitam mais de uma chave (ex.: `/employees` para cadastro, nova entrega e devolução; `/epis` para catálogo, entrega, estoque e funções × EPI).
- Sem escopo por empresa: quem tem a tela vê todas as empresas do tenant.
- Web: `useAuth().can(...chaves)` (helper único) esconde menus, abas e botões; o backend recusa com 403.
- Rotas públicas/serviço intactas: health/ready, verificação pública do comprovante, worker, biometric-service.

## Dispositivos

`POST /devices/register` (qualquer usuário logado) cria `PENDING`; aprovar/bloquear em Administração → Dispositivos (`administracao.dispositivos.atualizar`). `@RequireTrustedDevice()` (entrega/biometria) exige header `X-Device-Key` de dispositivo `TRUSTED` quando o tenant tem `requireTrustedDevice`.

## Legado no banco

`roles`, `permissions`, `role_permissions`, `user_roles`, `webauthn_credentials` e `users.webauthnUserHandle` ficam sem uso (migração `20261013120000_acesso_central` revogou as sessões abertas para todos entrarem pela central). Seed cria só tenant, motivos, termo e registros LGPD.

## Fora do padrão do ecossistema

Padrão Robby = encerrar após 30 min sem interação ([authentication.md](file:///C:/ROBBY/docs/robby/authentication.md)). Hoje a sessão vive enquanto o refresh for válido (14 dias) e a sessão central estiver ativa no check. Alinhar: keeper de inatividade no `(app)/layout.tsx` + TTL do refresh por inatividade.

## Arquivos

`packages/permissions/src/index.ts` (catálogo, `pode`) · `apps/api/src/core/auth.guard.ts` (`@Acesso`) · `apps/api/src/modules/identity/` (`sso.ts`, `auth.service.ts`, `devices.controller.ts`, `sso.test.ts`) · `apps/api/src/core/auth.guard.test.ts` · `apps/web/src/lib/auth.tsx` (`can`), `sso.ts`, `api.ts` · web `login/`, `(app)/conta/`, `(app)/dispositivo/`, `(app)/admin/`.
