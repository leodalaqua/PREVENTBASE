# PreventBase - SUMMARY

## Responsabilidade

Plataforma central de SST multiempresa com o colaborador como entidade principal. Fase 1 (no ar): gestão completa de EPI — estoque por lote/FEFO, CAEPI, entrega com biometria facial 1:1 + prova de vida, ficha eletrônica, devolução, inventário, documentos, auditoria. eSocial **somente leitura/importação** (fase futura). Operado por gestor/técnico/RH/líder; colaborador não precisa de celular.

Fonte do produto: [MASTER-PLAN.md](MASTER-PLAN.md) (referenciar por `§N`).

## Stack

Next.js 15 PWA (`apps/web`) · NestJS 11 modular monolith (`apps/api`) · worker BullMQ (`apps/worker`) · Prisma 6 + PostgreSQL 16 (`packages/database`) · Redis · MinIO · biometric-service FastAPI + OpenCV (`apps/biometric-service`, isolado) · nginx · Docker (`docker-compose.yml`) · monorepo pnpm 11.

## Módulos

| Módulo | Doc |
|--------|-----|
| Organização: empresas, estabelecimentos, setores, funções × EPI, colaboradores | [organizacao.md](organizacao.md) |
| Identidade: login, refresh, MFA, perfis/permissões, escopo, dispositivos | [identidade.md](identidade.md) |
| EPI, variações, CA/CAEPI (válido na compra ≠ válido hoje) | [epi-ca.md](epi-ca.md) |
| Estoque: almoxarifados, lotes, movimentos, FEFO, inventário, alertas | [estoque.md](estoque.md) |
| Entrega, evidência (hash + PDF + QR), devolução, ficha, verificação pública | [entrega.md](entrega.md) |
| Biometria facial (serviço isolado, desafio de prova de vida) | [biometria.md](biometria.md) |
| Documentos (MinIO, versões) | [documentos.md](documentos.md) |
| Auditoria (cadeia de hash), imutabilidade, LGPD | [auditoria.md](auditoria.md) |
| Relatórios, dashboard, busca, notificações | [relatorios.md](relatorios.md) |
| Operação: deploy, worker/jobs, backup, smoke E2E | [operacao.md](operacao.md) |
| Riscos/PGR, treinamentos, saúde, acidentes, eSocial leitura | MASTER-PLAN §20-§44 (sem código; entidades reservadas no schema) |

## Invariantes

`.cursor/rules/10-preventbase-invariants.mdc` (sempre aplicada) - resumo de §0 e §79.

## Integrações

Base CAEPI/MTE (download do arquivo oficial, `CAEPI_SOURCE_URL`) → [epi-ca.md](epi-ca.md). Nenhuma integração com outros apps do ecossistema. Previstas: eSocial download/consulta (§39-§40), `EmployeeProvider` RH (§69).

## Dependências

Robby: catálogo de portas/acessos (`C:\ROBBY\config\ports.json`, `magicdns.json`, `stack.json`), portal Veritech (aba tailnet HTTPS `:13100`; `frame-ancestors` no nginx) e leitura externa via pg-gateway (`preventbase_leitura`). `postgres` e `nginx` também em `robby_net`.

## Arquivos principais

| Path | Função |
|------|--------|
| `apps/api/src/core/` | Contexto (AsyncLocalStorage), guard JWT/permissões/dispositivo, auditoria, idempotência, storage, fila |
| `apps/api/src/modules/` | Controllers/serviços por módulo (`/api/v1`, Swagger em `/api/v1/docs`) |
| `apps/worker/src/` | Jobs agendados (alertas, cadeia, reconciliação, CAEPI) |
| `apps/biometric-service/app/` | Detecção/embedding/prova de vida, templates cifrados |
| `apps/web/src/app/` | UI (`(app)/*` autenticado, `login/`, `verificar/[publicId]` público) |
| `packages/database/prisma/` | Schema, migrations (triggers de imutabilidade em `*_integrity`) |
| `packages/contracts/` · `packages/permissions/` | Schemas Zod, labels, catálogo de permissões/perfis |
| `infrastructure/` | Dockerfile (targets api/worker/web), nginx, backup |
| `scripts/e2e-smoke.ps1` | Smoke E2E isolado |

## Portas

App (nginx) `:3100` · API `:3101` (nginx só `/api/`) · Postgres `:3110` · MinIO `127.0.0.1:3112/:3113`. Redis, worker e biometric só na rede interna. Fonte: `C:\ROBBY\config\ports.json` (id 31); mudar porta → regra `40-hub-ports`.
