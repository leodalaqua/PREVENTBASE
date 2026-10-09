# Operação

## Deploy

- `.env` a partir de `.env.example` (segredos aleatórios; nunca versionar). `docker compose up -d --build`.
- 9 serviços: postgres, redis, minio, biometric, api, worker, web, nginx, backup. Imagens Node em `infrastructure/docker/Dockerfile` (targets `api`/`worker`/`web`, pnpm 11.7.0 via corepack).
- `api` no start: `prisma migrate deploy` → seed idempotente → `node apps/api/dist/main.js`.
- Saúde: `GET /api/v1/health` (processo) e `/api/v1/ready` (DB, Redis, MinIO, biometria). Worker: heartbeat em arquivo (`apps/worker/healthcheck.mjs`).
- Dev no host: `pnpm install --no-frozen-lockfile` (sem `CI=true`), `pnpm build:packages`, `pnpm dev:api`, `pnpm dev:web` (`:3100`, proxy `/api` → `:3101`).

## Frontend (PWA)

Padrões do ecossistema: [responsivo](file:///C:/ROBBY/docs/decisions/2026-10-03-frontends-responsivos.md) e [PWA](file:///C:/ROBBY/docs/decisions/2026-10-08-frontends-pwa.md). Acesso com câmera: `https://servidor.taild57d57.ts.net:13100` (tailnet HTTPS, `C:\ROBBY\scripts\tailnet-https.ps1`). Arquivos: `apps/web/public/` (manifest, `sw.js`, `offline.html`, ícones e `brand/` — gerados por `scripts/brand.mjs` a partir de `apps/web/brand/preventbase-logo.png`), `src/components/pwa.tsx` (registro, atualização, instalar, offline), `src/app/(app)/layout.tsx` (sidebar/drawer < 1024 px, barra inferior no celular).

## Worker (BullMQ, fila `preventbase`, tz America/Sao_Paulo)

`alerts` (`5 * * * *`, também no boot) · `audit-verify` (02:30) · `stock-reconcile` (02:45) · `caepi-sync` (04:15, só com `CAEPI_SOURCE_URL`).

## Backup

`infrastructure/postgres/backup.sh` no container `preventbase-backup`: diário às `BACKUP_HOUR` (03) e na primeira subida. `pg_dump -Fc` → restauração de teste em `preventbase_restore_check` (`RESTORE_OK`/`RESTORE_FAILED`) → tar dos volumes MinIO e biometria → `SHA256SUMS`. Destino `./backups/<data>`; retenção `BACKUP_RETENTION_DAYS` (14). O biometric-service faz também cópia diária própria do SQLite.

## Smoke E2E

`powershell -File scripts/e2e-smoke.ps1`: cria banco `preventbase_e2e` + API temporária (`127.0.0.1:3199`, Redis db 5, bucket `preventbase-e2e`), roda `scripts/e2e-smoke.mjs` (25 passos: auth, organização, entradas idempotentes, FEFO, estoque negativo, entrega com biometria sintética, replay, troca antecipada, verificação pública, PDF, triggers, devolução, documentos, relatórios, cancelamento, cadeia) e remove tudo. Nunca apontar para o banco de produção.
